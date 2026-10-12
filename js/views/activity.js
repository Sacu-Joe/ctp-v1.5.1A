/* ============================================================
 * views/activity.js — 活动模块（数据按学校保存）
 *  · 三视图：卡片墙（默认）/ 列表 / 日历，可一键切换
 *  · 进入模块与增删改后，自动把已结束活动归档（从界面移除，历史保留）
 *  · 双击活动卡片 / 行：编辑或删除；新建 / 编辑弹窗含名称、日期、类型、
 *    全天、起止时间、地点、组织者、备注，含必填与时间先后校验
 *  · 历史记录：只读查看归档文本，并可导出为“活动历史.txt”
 * ============================================================ */
(function (global) {
  'use strict';

  const WK = ['日', '一', '二', '三', '四', '五', '六'];
  const CAL_WK = ['一', '二', '三', '四', '五', '六', '日'];

  const view = {
    school: null,
    mode: 'cards',   // cards | list | cal
    items: [],       // 当前学校未归档活动（已排序）
    sel: null,       // 日历选中日期 'yyyy-MM-dd'
    vy: null, vm: null
  };

  function colorOf(t) { return App.ACTIVITY_COLOR[t] || App.ACTIVITY_COLOR['其他']; }
  function weekText(s) {
    const d = U.parseDate(s);
    if (!d) return s || '';
    return (d.getMonth() + 1) + '/' + d.getDate() + ' 周' + WK[d.getDay()];
  }
  function timeText(a) {
    if (U.timeToSec(a.start) === null) return '全天';
    return a.start + (a.end ? '–' + a.end : '');
  }
  // 与桌面版一致：日期升序 → 开始时间升序（全天视为 24:00 排最后）→ 名称
  function sortActs(list) {
    return list.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
      const sa = U.timeToSec(a.start), sb = U.timeToSec(b.start);
      const xa = sa === null ? 86400 : sa, xb = sb === null ? 86400 : sb;
      if (xa !== xb) return xa - xb;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
  }
  function hhmmPlusMinutes(base, mins) {
    let t = base.getHours() * 60 + base.getMinutes() + mins;
    if (t > 23 * 60 + 59) t = 23 * 60 + 59;
    if (t < 0) t = 0;
    return U.pad2(Math.floor(t / 60)) + ':' + U.pad2(t % 60);
  }

  view.mount = async function (root) {
    view.school = App.state.school;
    const today = U.todayStr();
    if (!view.sel) {
      view.sel = today;
      const t = new Date(); view.vy = t.getFullYear(); view.vm = t.getMonth();
    }

    async function loadData() {
      try { await Store.archivePast(view.school, new Date()); } catch (e) { /* 忽略归档异常 */ }
      view.items = sortActs(await Store.listActivities(view.school, false));
    }
    await loadData();

    const v = App.el('div', 'view');
    v.innerHTML =
      '<div class="toolbar act-toolbar">' +
      '<div class="act-sub"><div class="act-sub-t">活动安排</div>' +
      '<div class="act-sub-s">校园活动安排；已结束活动自动归档到历史记录（数据按学校保存）</div></div>' +
      '<div class="spacer"></div>' +
      '<button class="btn-ghost" id="actHistory" type="button">' + App.icon('history') + '历史记录</button>' +
      '<button class="btn-add" id="actAdd" type="button">' + App.icon('add', 'ico-white') + '新建活动</button>' +
      '</div>' +
      '<div class="act-viewbar"><span class="act-vlab">视图：</span>' +
      '<button class="act-vbtn" id="vwCards" type="button">' + App.icon('view_cards') + '卡片墙</button>' +
      '<button class="act-vbtn" id="vwList" type="button">' + App.icon('view_list') + '列表</button>' +
      '<button class="act-vbtn" id="vwCal" type="button">' + App.icon('view_calendar') + '日历</button>' +
      '</div>' +
      '<div class="act-content">' +
      '<section class="act-pane" id="paneCards"><div class="act-cards" id="actCards"></div></section>' +
      '<section class="act-pane" id="paneList"><div class="act-list" id="actList"></div></section>' +
      '<section class="act-pane act-pane-cal" id="paneCal"><div class="act-cal">' +
      '<div class="cal-panel"><div class="cal-head">' +
      '<button class="nav-btn" id="actPrev" type="button" title="上一月">' + App.icon('arrow_left') + '</button>' +
      '<div class="cal-title" id="actCalTitle"></div>' +
      '<button class="nav-btn" id="actNext" type="button" title="下一月">' + App.icon('arrow_right') + '</button>' +
      '</div>' +
      '<div class="cal-week">' + CAL_WK.map(function (w) { return '<span>' + w + '</span>'; }).join('') + '</div>' +
      '<div class="cal-grid" id="actCalGrid"></div></div>' +
      '<div class="act-calday"><div class="act-calday-head" id="actCalDayHead"></div>' +
      '<div class="act-calday-list" id="actCalDayList"></div></div>' +
      '</div></section>' +
      '</div>';
    root.appendChild(v);

    const cards = v.querySelector('#actCards');
    const list = v.querySelector('#actList');
    const calGrid = v.querySelector('#actCalGrid');
    const calDayList = v.querySelector('#actCalDayList');
    const paneIds = { cards: 'paneCards', list: 'paneList', cal: 'paneCal' };
    const btnIds = { cards: 'vwCards', list: 'vwList', cal: 'vwCal' };

    /* ---------- 单个活动卡片 / 行 ---------- */
    function tagHtml(a) {
      const c = colorOf(a.type);
      return '<span class="ac-tag" style="color:' + c + ';border-color:' + c + ';">' +
        App.esc(a.type || '其他') + '</span>';
    }
    // 单击看详情 / 双击编辑（单击延迟 220ms，避免与双击冲突）
    function bindCard(el, a) {
      let timer = null;
      el.addEventListener('click', function () {
        if (timer) return;
        timer = setTimeout(function () { timer = null; App.openActivityDetail(a); }, 220);
      });
      el.addEventListener('dblclick', function () {
        if (timer) { clearTimeout(timer); timer = null; }
        openDialog(a);
      });
      el.title = '单击查看详情 / 双击编辑';
    }

    function buildCard(a) {
      const c = colorOf(a.type);
      const card = App.el('div', 'act-card');
      card.style.borderLeftColor = c;
      card.innerHTML =
        '<div class="ac-top"><span class="ac-name">' + App.esc(a.name) + '</span>' + tagHtml(a) + '</div>' +
        '<div class="ac-line">📅 ' + App.esc(weekText(a.date)) + '　🕒 ' + App.esc(timeText(a)) + '</div>' +
        (a.place ? '<div class="ac-line ac-sub">📍 ' + App.esc(a.place) + '</div>' : '') +
        (a.organizer ? '<div class="ac-line ac-sub">👤 ' + App.esc(a.organizer) + '</div>' : '') +
        (a.note ? '<div class="ac-note">' + App.esc(a.note) + '</div>' : '') +
        '<div class="ac-hint">单击看详情 / 双击编辑</div>';
      bindCard(card, a);
      return card;
    }
    function buildRow(a) {
      const c = colorOf(a.type);
      const row = App.el('div', 'act-row');
      row.style.borderLeftColor = c;
      row.innerHTML =
        tagHtml(a) +
        '<span class="ar-name">' + App.esc(a.name) + '</span>' +
        '<span class="ar-dt">📅 ' + App.esc(weekText(a.date)) + '　🕒 ' + App.esc(timeText(a)) + '</span>' +
        '<span class="ar-place">📍 ' + App.esc(a.place || '—') + '</span>' +
        '<span class="ar-org">' + App.esc(a.organizer || '') + '</span>';
      bindCard(row, a);
      return row;
    }

    /* ---------- 三视图渲染 ---------- */
    function renderCards() {
      cards.innerHTML = '';
      if (!view.items.length) {
        cards.appendChild(App.el('div', 'act-empty',
          '暂无活动\n点击右上角“新建活动”添加；已结束的活动会自动归档到历史记录'));
        return;
      }
      view.items.forEach(function (a) { cards.appendChild(buildCard(a)); });
    }
    function renderList() {
      list.innerHTML = '';
      const head = App.el('div', 'act-row act-row-head');
      head.innerHTML =
        '<span class="ar-tag"></span><span class="ar-name">名称</span>' +
        '<span class="ar-dt">日期 / 时间</span><span class="ar-place">地点</span><span class="ar-org">组织者</span>';
      list.appendChild(head);
      if (!view.items.length) { list.appendChild(App.el('div', 'act-empty', '暂无活动')); return; }
      view.items.forEach(function (a) { list.appendChild(buildRow(a)); });
    }
    function renderCalendar() {
      v.querySelector('#actCalTitle').textContent = view.vy + ' 年 ' + (view.vm + 1) + '月';
      calGrid.innerHTML = '';
      const first = new Date(view.vy, view.vm, 1);
      const offset = (first.getDay() + 6) % 7;
      const start = U.addDays(first, -offset);
      const dateSet = {};
      view.items.forEach(function (a) { dateSet[a.date] = true; });
      const nowStr = U.todayStr();
      for (let i = 0; i < 42; i++) {
        const d = U.addDays(start, i);
        const ds = U.dateStr(d);
        const out = d.getMonth() !== view.vm;
        const cls = ['cal-cell'];
        if (out) cls.push('out');
        if (ds === nowStr) cls.push('today');
        if (ds === view.sel) cls.push('sel');
        if (dateSet[ds]) cls.push('hasact');
        const cell = App.el('div', cls.join(' '));
        cell.innerHTML = '<span class="num">' + d.getDate() + '</span>';
        (function (dateStr, dateObj) {
          cell.addEventListener('click', function () { selectDate(dateStr, out ? dateObj : null); });
        })(ds, d);
        calGrid.appendChild(cell);
      }
    }
    function renderCalDay() {
      const sd = U.parseDate(view.sel);
      const todays = view.items.filter(function (a) { return a.date === view.sel; });
      v.querySelector('#actCalDayHead').textContent =
        (sd.getMonth() + 1) + '/' + sd.getDate() + ' 周' + WK[sd.getDay()] + ' 的活动（' + todays.length + '）';
      calDayList.innerHTML = '';
      if (!todays.length) { calDayList.appendChild(App.el('div', 'act-empty', '当天暂无活动')); return; }
      todays.forEach(function (a) { calDayList.appendChild(buildRow(a)); });
    }
    function renderAll() { renderCards(); renderList(); renderCalendar(); renderCalDay(); }

    async function refresh() {
      await loadData();
      // 若当前选中日因切月越界，保持合法
      renderAll();
    }
    function selectDate(ds, outDate) {
      view.sel = ds;
      if (outDate) { view.vy = outDate.getFullYear(); view.vm = outDate.getMonth(); }
      renderCalendar(); renderCalDay();
    }
    function setMode(mode) {
      view.mode = mode;
      Object.keys(paneIds).forEach(function (k) {
        v.querySelector('#' + paneIds[k]).classList.toggle('show', k === mode);
      });
      Object.keys(btnIds).forEach(function (k) {
        v.querySelector('#' + btnIds[k]).classList.toggle('active', k === mode);
      });
    }

    /* ---------- 新建 / 编辑弹窗 ---------- */
    function openDialog(edit) {
      const isEdit = !!edit;
      const now = new Date();
      const d0 = isEdit ? edit : {
        name: '', date: view.sel, start: hhmmPlusMinutes(now, 0), end: hhmmPlusMinutes(now, 60),
        place: '', organizer: '', type: '社团', note: ''
      };
      const typeOpts = U.ACTIVITY_TYPES.map(function (t) {
        return '<option value="' + App.esc(t) + '">' + App.esc(t) + '</option>';
      }).join('');
      const body =
        '<div class="form-grid">' +
        '<div class="field full"><label>活动名称 <b>*</b></label>' +
        '<input type="text" id="f_a_name" placeholder="如：社团招新 / 校园歌手大赛" maxlength="60"></div>' +
        '<div class="field"><label>日期 <b>*</b></label><input type="date" id="f_a_date"></div>' +
        '<div class="field"><label>类型</label><select id="f_a_type">' + typeOpts + '</select></div>' +
        '<div class="field full"><label class="checkline">' +
        '<input type="checkbox" id="f_a_allday"> 全天（不设具体时间）</label></div>' +
        '<div class="field"><label>开始</label><input type="time" id="f_a_start" step="60"></div>' +
        '<div class="field"><label>结束</label><input type="time" id="f_a_end" step="60"></div>' +
        '<div class="field full"><label>地点</label>' +
        '<input type="text" id="f_a_place" placeholder="如：大学生活动中心" maxlength="60"></div>' +
        '<div class="field full"><label>组织者</label>' +
        '<input type="text" id="f_a_organizer" placeholder="如：学生会 / 某社团" maxlength="40"></div>' +
        '<div class="field full"><label>备注</label>' +
        '<textarea id="f_a_note" rows="2" maxlength="200" placeholder="可选"></textarea></div>' +
        '</div>';
      const cfg = App.modal({
        title: isEdit ? '编辑活动' : '新建活动', body: body,
        buttons: [
          { label: '删除', type: 'danger', onClick: function () { return doDelete(); } },
          { label: '取消', onClick: function () {} },
          { label: '保存', type: 'primary', onClick: function () { return doSave(); } }
        ]
      });
      const r = cfg.root;
      const nameI = r.querySelector('#f_a_name');
      const dateI = r.querySelector('#f_a_date');
      const typeI = r.querySelector('#f_a_type');
      const allCb = r.querySelector('#f_a_allday');
      const startI = r.querySelector('#f_a_start');
      const endI = r.querySelector('#f_a_end');
      const placeI = r.querySelector('#f_a_place');
      const orgI = r.querySelector('#f_a_organizer');
      const noteI = r.querySelector('#f_a_note');
      const defStart = hhmmPlusMinutes(now, 0), defEnd = hhmmPlusMinutes(now, 60);

      nameI.value = d0.name || '';
      dateI.value = d0.date;
      typeI.value = U.ACTIVITY_TYPES.indexOf(d0.type) >= 0 ? d0.type : '其他';
      const isAll = !d0.start;
      allCb.checked = isAll;
      startI.value = isAll ? '' : (d0.start || '');
      endI.value = isAll ? '' : (d0.end || '');
      placeI.value = d0.place || '';
      orgI.value = d0.organizer || '';
      noteI.value = d0.note || '';
      function syncAllDay() {
        const ad = allCb.checked;
        startI.disabled = ad; endI.disabled = ad;
        if (!ad && !startI.value) { startI.value = defStart; endI.value = defEnd; }
      }
      allCb.addEventListener('change', syncAllDay);
      syncAllDay();
      r.querySelector('.btn-danger').style.display = isEdit ? '' : 'none';
      setTimeout(function () { nameI.focus(); }, 60);

      async function doSave() {
        const name = nameI.value.trim();
        if (!name) { App.toast('请填写活动名称', 'err'); return false; }
        const date = dateI.value;
        if (!U.parseDate(date)) { App.toast('请选择有效日期', 'err'); return false; }
        const ad = allCb.checked;
        let start = '', end = '';
        if (!ad) {
          start = startI.value || '';
          end = endI.value || '';
          const ts = U.timeToSec(start);
          if (ts === null) { App.toast('请选择开始时间，或勾选“全天”', 'err'); return false; }
          const te = U.timeToSec(end);
          if (te !== null && te < ts) { App.toast('结束时间不能早于开始时间', 'err'); return false; }
          if (te === null) end = '';
        }
        const data = {
          name: name, date: date, start: start, end: end,
          place: placeI.value.trim(), organizer: orgI.value.trim(),
          type: typeI.value, note: noteI.value.trim()
        };
        if (isEdit) {
          await Store.updateActivity(edit.id, data);
          App.toast('已保存修改', 'ok');
        } else {
          await Store.addActivity(view.school, data);
          App.toast('已添加活动', 'ok');
        }
        // 新建 / 编辑后，若日期落在今天之前会被自动归档，故选中日随之合理
        if (view.sel !== date && !isEdit) view.sel = date;
        await refresh();
      }
      async function doDelete() {
        const ok = await App.confirm('确定删除活动「' + edit.name + '」吗？',
          { title: '删除活动', okText: '删除' });
        if (!ok) return false;
        await Store.deleteActivity(edit.id);
        App.toast('已删除活动', 'ok');
        await refresh();
      }
    }

    /* ---------- 历史记录 ---------- */
    async function showHistory() {
      let text = '';
      try { text = await Store.historyText(view.school); } catch (e) { text = ''; }
      const body =
        '<div class="hist-tip">已结束的活动会在进入模块时自动归档；可导出为“活动历史.txt”留存（只读）。</div>' +
        '<textarea class="hist-box" id="histBox" readonly>' +
        App.esc(text || '暂无历史记录。') + '</textarea>';
      App.modal({
        title: '活动历史记录', body: body,
        buttons: [
          {
            label: '导出为 txt', onClick: async function () {
              try {
                await Store.exportHistoryTxt(view.school, '活动历史.txt');
                App.toast('已导出 活动历史.txt', 'ok');
              } catch (e) { App.toast(e.message || '导出失败', 'err'); }
              return false; // 保持弹窗，便于继续查看
            }
          },
          { label: '关闭', type: 'primary' }
        ]
      });
    }

    /* ---------- 事件 ---------- */
    v.querySelector('#actAdd').addEventListener('click', function () { openDialog(null); });
    v.querySelector('#actHistory').addEventListener('click', showHistory);
    v.querySelector('#vwCards').addEventListener('click', function () { setMode('cards'); });
    v.querySelector('#vwList').addEventListener('click', function () { setMode('list'); });
    v.querySelector('#vwCal').addEventListener('click', function () { setMode('cal'); });
    v.querySelector('#actPrev').addEventListener('click', function () {
      const d = new Date(view.vy, view.vm - 1, 1);
      view.vy = d.getFullYear(); view.vm = d.getMonth(); renderCalendar();
    });
    v.querySelector('#actNext').addEventListener('click', function () {
      const d = new Date(view.vy, view.vm + 1, 1);
      view.vy = d.getFullYear(); view.vm = d.getMonth(); renderCalendar();
    });

    renderAll();
    setMode(view.mode);

    // 从首页跳转过来时，直接打开对应活动的详情
    const pd = App.pendingDetail;
    if (pd && pd.type === 'activity') {
      App.pendingDetail = null;
      const hit = view.items.filter(function (x) { return x.id === pd.id; })[0];
      if (hit) { setMode('cards'); App.openActivityDetail(hit); }
      else App.toast('该活动已归档或不存在', 'err');
    }
  };

  global.App.views.activity = view;
})(window);
