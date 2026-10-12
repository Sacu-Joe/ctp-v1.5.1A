/* ============================================================
 * views/schedule.js — 日程模块（数据全局，不区分学校）
 *  · 左侧月历：切换月份、选中日期；有日程的日期加青绿圆点，今天描边、选中实心
 *  · 右侧当日待办：完成勾选、双击编辑、删除；未完成在前、按开始时间升序（全天排最后）
 *  · 新建 / 编辑弹窗：内容、日期、全天、起止时间、备注；含必填与时间先后校验
 *  · 到点提醒：在「设置」里开启后，导出 .ics 到系统日历，由系统日历提醒
 * ============================================================ */
(function (global) {
  'use strict';

  const WK = ['一', '二', '三', '四', '五', '六', '日'];

  const view = {
    title: '日程',
    sel: null,    // 选中日期 'yyyy-MM-dd'
    vy: null, vm: null,  // 月历当前显示的年 / 月（0-based）
    all: [],      // 全部日程
    map: {}       // date -> 条数
  };

  function timeText(it) {
    if (U.timeToSec(it.start) === null) return '全天';
    return it.start + (it.end ? ' – ' + it.end : '');
  }

  // 与桌面版一致：未完成在前；其后按开始时间升序（全天视为 24:00 排最后）；再按标题
  function daySort(list) {
    return list.slice().sort(function (a, b) {
      if (a.done !== b.done) return a.done ? 1 : -1;
      const sa = U.timeToSec(a.start), sb = U.timeToSec(b.start);
      const xa = sa === null ? 86400 : sa, xb = sb === null ? 86400 : sb;
      if (xa !== xb) return xa - xb;
      return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
    });
  }

  function hhmmPlusMinutes(base, mins) {
    let t = base.getHours() * 60 + base.getMinutes() + mins;
    if (t > 23 * 60 + 59) t = 23 * 60 + 59;
    if (t < 0) t = 0;
    return U.pad2(Math.floor(t / 60)) + ':' + U.pad2(t % 60);
  }

  view.mount = async function (root) {
    const today = U.todayStr();
    if (!view.sel) view.sel = today;
    if (view.vy == null) {
      const sd = U.parseDate(view.sel) || new Date();
      view.vy = sd.getFullYear(); view.vm = sd.getMonth();
    }
    view.all = await Store.listSchedules();
    view.map = {};
    view.all.forEach(function (it) { view.map[it.date] = (view.map[it.date] || 0) + 1; });

    const v = App.el('div', 'view');
    v.innerHTML =
      '<div class="toolbar sch-toolbar">' +
      '<button class="sch-collapse" id="schCollapse" type="button" title="展开日历">▸</button>' +
      '<div class="sch-sub"><div class="sch-sub-t">日程安排</div></div>' +
      '<div class="spacer"></div>' +
      '<button class="btn-today" id="schSync" type="button" title="把课程表和活动一起同步到系统日历">同步课表和活动</button>' +
      '<button class="btn-add" id="schAdd" type="button">' + App.icon('add', 'ico-white') + '新建日程</button>' +
      '</div>' +
      '<div class="sch-body cal-collapsed" id="schBody">' +
      '<section class="cal-panel"><div class="cal-head">' +
      '<button class="nav-btn" id="calPrev" type="button" title="上一月">' + App.icon('arrow_left') + '</button>' +
      '<div class="cal-title" id="calTitle"></div>' +
      '<button class="nav-btn" id="calNext" type="button" title="下一月">' + App.icon('arrow_right') + '</button>' +
      '</div>' +
      '<div class="cal-week">' + WK.map(function (w) { return '<span>' + w + '</span>'; }).join('') + '</div>' +
      '<div class="cal-grid" id="calGrid"></div></section>' +
      '<section class="day-panel"><div class="day-head">' +
      '<div class="day-title" id="dayTitle"></div>' +
      '<button class="btn-today" id="dayToday" type="button">回到今天</button>' +
      '</div><div class="day-list" id="dayList"></div></section>' +
      '</div>';
    root.appendChild(v);

    const grid = v.querySelector('#calGrid');
    const list = v.querySelector('#dayList');

    /* ---------- 日历折叠 / 展开（默认折叠） ---------- */
    let calCollapsed = true;
    const collapseBtn = v.querySelector('#schCollapse');
    function applyCollapsed() {
      v.querySelector('#schBody').classList.toggle('cal-collapsed', calCollapsed);
      collapseBtn.textContent = calCollapsed ? '▸' : '▾';
      collapseBtn.title = calCollapsed ? '展开日历' : '折叠日历';
    }
    collapseBtn.addEventListener('click', function () {
      calCollapsed = !calCollapsed;
      applyCollapsed();
    });

    /* ---------- 月历 ---------- */
    function renderCalendar() {
      v.querySelector('#calTitle').textContent = view.vy + ' 年 ' + (view.vm + 1) + ' 月';
      grid.innerHTML = '';
      const first = new Date(view.vy, view.vm, 1);
      const offset = (first.getDay() + 6) % 7;            // 周一为一周起点
      const start = U.addDays(first, -offset);
      const nowStr = U.todayStr();
      for (let i = 0; i < 42; i++) {
        const d = U.addDays(start, i);
        const ds = U.dateStr(d);
        const out = d.getMonth() !== view.vm;
        const cls = ['cal-cell'];
        if (out) cls.push('out');
        if (ds === nowStr) cls.push('today');
        if (ds === view.sel) cls.push('sel');
        if (view.map[ds]) cls.push('has');
        const cell = App.el('div', cls.join(' '));
        cell.innerHTML = '<span class="num">' + d.getDate() + '</span>' +
          (view.map[ds] ? '<i class="cal-dot"></i>' : '');
        (function (dateStr, dateObj) {
          cell.addEventListener('click', function () { selectDate(dateStr, out ? dateObj : null); });
        })(ds, d);
        grid.appendChild(cell);
      }
    }

    /* ---------- 当日待办（日程 + 课程 + 活动） ---------- */
    async function renderDay() {
      const mySel = view.sel;
      const sd = U.parseDate(mySel);
      const nowStr = U.todayStr();
      v.querySelector('#dayTitle').textContent =
        (mySel === nowStr ? '今天 · ' : '') + (sd.getMonth() + 1) + '月' + sd.getDate() +
        '日 星期' + WK[U.dayOfWeek(sd) - 1];

      const items = daySort(view.all.filter(function (it) { return it.date === mySel; }));
      const undone = items.filter(function (it) { return !it.done; }).length;

      // 课程表与活动：一并显示在当天的日程里
      let courses = [], acts = [];
      try {
        const school = App.state.school;
        courses = await Store.coursesForDate(school, sd);
        acts = await Store.activitiesForDate(school, mySel, false);
      } catch (e) { /* 忽略 */ }
      if (mySel !== view.sel) return;   // 用户已切换日期，丢弃过期结果

      list.innerHTML = '';
      list.appendChild(App.el('div', 'day-sum',
        '日程 ' + items.length + ' 项（' + undone + ' 未完成）· 课程 ' + courses.length + ' 节 · 活动 ' + acts.length + ' 个'));

      if (!items.length && !courses.length && !acts.length) {
        list.appendChild(App.el('div', 'empty', '当天暂无日程\n点击右上角“新建日程”添加'));
        // \n 需 white-space 处理（.day-list .empty 已设置 pre-line）
        return;
      }

      // 课程（只读）
      courses.forEach(function (c) {
        const card = App.el('div', 'scard src-course');
        card.innerHTML =
          '<div class="sc-main"><div class="sc-title">📚 ' + App.esc(c.name) + '</div>' +
          '<div class="sc-sub">第 ' + c.startPeriod + (c.endPeriod !== c.startPeriod ? '–' + c.endPeriod : '') + ' 节' +
          (c.place ? '　' + App.esc(c.place) : '') + (c.teacher ? '　' + App.esc(c.teacher) : '') + '</div></div>';
        list.appendChild(card);
      });
      // 活动（只读）
      acts.forEach(function (a) {
        const card = App.el('div', 'scard src-activity');
        card.innerHTML =
          '<div class="sc-main"><div class="sc-title">🎪 ' + App.esc(a.name) + '</div>' +
          '<div class="sc-sub">' + App.esc(timeText(a)) +
          (a.place ? '　' + App.esc(a.place) : '') + (a.organizer ? '　' + App.esc(a.organizer) : '') + '</div></div>';
        list.appendChild(card);
      });

      items.forEach(function (it) {
        const card = App.el('div', 'scard' + (it.done ? ' done' : ''));
        const ck = document.createElement('input');
        ck.type = 'checkbox'; ck.className = 's-check'; ck.checked = !!it.done;
        ck.title = it.done ? '标记为未完成' : '标记为完成';
        const main = App.el('div', 'sc-main');
        main.title = '双击编辑';
        main.innerHTML =
          '<div class="sc-title">' + App.esc(it.title) + '</div>' +
          '<div class="sc-sub">🕒 ' + App.esc(timeText(it)) +
          (it.note ? '　' + App.esc(it.note) : '') + '</div>';
        const del = App.el('button', 's-del', '删除');
        del.type = 'button';
        ck.addEventListener('change', async function () {
          await Store.setScheduleDone(it.id, ck.checked);
          await reloadAll();
        });
        main.addEventListener('dblclick', function () { openDialog(it); });
        del.addEventListener('click', async function () {
          const ok = await App.confirm('确定删除日程「' + it.title + '」吗？',
            { title: '删除日程', okText: '删除' });
          if (!ok) return;
          await Store.deleteSchedule(it.id);
          App.toast('已删除日程', 'ok');
          await reloadAll();
        });
        card.appendChild(ck);
        card.appendChild(main);
        card.appendChild(del);
        list.appendChild(card);
      });
    }

    async function reloadAll() {
      view.all = await Store.listSchedules();
      view.map = {};
      view.all.forEach(function (it) { view.map[it.date] = (view.map[it.date] || 0) + 1; });
      renderCalendar();
      renderDay();
    }

    function selectDate(ds, outDate) {
      view.sel = ds;
      if (outDate) { view.vy = outDate.getFullYear(); view.vm = outDate.getMonth(); }
      renderCalendar();
      renderDay();
    }

    /* ---------- 新建 / 编辑弹窗 ---------- */
    function openDialog(edit) {
      const isEdit = !!edit;
      const now = new Date();
      const defStart = hhmmPlusMinutes(now, 0);
      const defEnd = hhmmPlusMinutes(now, 60);
      const d0 = isEdit ? edit :
        { title: '', date: view.sel, start: defStart, end: defEnd, note: '' };
      const body =
        '<div class="form-grid">' +
        '<div class="field full"><label>日程内容 <b>*</b></label>' +
        '<input type="text" id="f_s_title" placeholder="如：交作业 / 小组开会 / 复诊" maxlength="60"></div>' +
        '<div class="field full"><label>日期</label><input type="date" id="f_s_date"></div>' +
        '<div class="field full"><label class="checkline">' +
        '<input type="checkbox" id="f_s_allday"> 全天（不设具体时间）</label></div>' +
        '<div class="field"><label>开始</label><input type="time" id="f_s_start" step="60"></div>' +
        '<div class="field"><label>结束</label><input type="time" id="f_s_end" step="60"></div>' +
        '<div class="field full"><label>备注</label>' +
        '<textarea id="f_s_note" rows="3" maxlength="200" placeholder="可选，如地点、要带的东西等"></textarea></div>' +
        '</div>';
      const cfg = App.modal({
        title: isEdit ? '编辑日程' : '新建日程', body: body,
        buttons: [
          { label: '删除', type: 'danger', onClick: function () { return doDelete(); } },
          { label: '取消', onClick: function () {} },
          { label: '保存', type: 'primary', onClick: function () { return doSave(); } }
        ]
      });
      const r = cfg.root;
      const titleInp = r.querySelector('#f_s_title');
      const dateInp = r.querySelector('#f_s_date');
      const allCb = r.querySelector('#f_s_allday');
      const startInp = r.querySelector('#f_s_start');
      const endInp = r.querySelector('#f_s_end');
      const noteInp = r.querySelector('#f_s_note');

      titleInp.value = d0.title || '';
      dateInp.value = d0.date;
      const isAll = !d0.start;
      allCb.checked = isAll;
      startInp.value = isAll ? '' : (d0.start || '');
      endInp.value = isAll ? '' : (d0.end || '');
      noteInp.value = d0.note || '';
      function syncTime() {
        const ad = allCb.checked;
        startInp.disabled = ad; endInp.disabled = ad;
        if (!ad && !startInp.value) { startInp.value = defStart; endInp.value = defEnd; }
      }
      allCb.addEventListener('change', syncTime);
      syncTime();
      r.querySelector('.btn-danger').style.display = isEdit ? '' : 'none';
      setTimeout(function () { titleInp.focus(); }, 60);

      async function doSave() {
        const title = titleInp.value.trim();
        if (!title) { App.toast('请填写日程内容', 'err'); return false; }
        const date = dateInp.value;
        if (!U.parseDate(date)) { App.toast('请选择有效日期', 'err'); return false; }
        const ad = allCb.checked;
        let start = '', end = '';
        if (!ad) {
          start = startInp.value || '';
          end = endInp.value || '';
          const ts = U.timeToSec(start);
          if (ts === null) { App.toast('请选择开始时间，或勾选“全天”', 'err'); return false; }
          const te = U.timeToSec(end);
          if (te !== null && te < ts) { App.toast('结束时间不能早于开始时间', 'err'); return false; }
          if (te === null) end = '';
        }
        const note = noteInp.value.trim();
        if (isEdit) {
          const patch = { title: title, date: date, start: start, end: end, note: note };
          if (edit.date !== date || edit.start !== start) patch.reminded = false;
          await Store.updateSchedule(edit.id, patch);
          App.toast('已保存修改', 'ok');
        } else {
          await Store.addSchedule({ title: title, date: date, start: start, end: end, note: note });
          App.toast('已添加日程', 'ok');
        }
        await reloadAll();
        // 保存后 5 秒内若没有新的保存，自动导出 ics 到日历
        App.scheduleAutoExport();
      }

      async function doDelete() {
        const ok = await App.confirm('确定删除日程「' + edit.title + '」吗？',
          { title: '删除日程', okText: '删除' });
        if (!ok) return false;
        await Store.deleteSchedule(edit.id);
        App.toast('已删除日程', 'ok');
        await reloadAll();
      }
    }

    /* ---------- 事件 ---------- */
    v.querySelector('#calPrev').addEventListener('click', function () {
      const d = new Date(view.vy, view.vm - 1, 1);
      view.vy = d.getFullYear(); view.vm = d.getMonth(); renderCalendar();
    });
    v.querySelector('#calNext').addEventListener('click', function () {
      const d = new Date(view.vy, view.vm + 1, 1);
      view.vy = d.getFullYear(); view.vm = d.getMonth(); renderCalendar();
    });
    v.querySelector('#dayToday').addEventListener('click', function () {
      const t = new Date();
      view.sel = U.dateStr(t); view.vy = t.getFullYear(); view.vm = t.getMonth();
      renderCalendar(); renderDay();
    });
    v.querySelector('#schAdd').addEventListener('click', function () { openDialog(null); });
    v.querySelector('#schSync').addEventListener('click', function () {
      App.exportSchedulesToCalendar();   // 含课程表与活动，一键同步到系统日历
    });

    renderCalendar();
    renderDay();
  };

  global.App.views.schedule = view;
})(window);
