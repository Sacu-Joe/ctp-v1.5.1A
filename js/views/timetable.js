/* ============================================================
 * views/timetable.js — 课程表模块（教学周课表）
 *  · 周次导航（第 N 周 + 单/双周徽标）、回到本周
 *  · 单一 CSS Grid：节次格 / 星期空白格 / 课程块共用同一套轨道，连堂严格沿网格线跨多行
 *  · 单击空白格按该天该节新增；双击课程块编辑 / 删除（单击不触发）
 *  · 课表设置：总周数 / 每天节次 / 开学日期；数据按学校隔离
 * ============================================================ */
(function (global) {
  'use strict';

  const PALETTE = ['#0d9488', '#2563eb', '#d97706', '#dc2626', '#7c3aed',
    '#0891b2', '#65a30d', '#db2777'];
  const DAY_HEADS = ['节次', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  function colorOf(name) {
    let h = 0;
    const s = String(name || '');
    for (let i = 0; i < s.length; i++) h = ((h * 31) + s.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }
  function md(d) { return (d.getMonth() + 1) + '/' + d.getDate(); }

  const view = {
    title: '课程表',
    selWeek: null,   // 记住用户浏览的周次（跨进入保留）
    zoom: null,      // 网格缩放比例（跨进入保留）

    async mount(root) {
      const school = App.state.school;
      let rec = await Store.currentSchoolRecord();
      let courses = await Store.listCourses(school);
      const now = new Date();
      const todayWeek = U.weekNumberOf(rec.firstDate, now);
      const todayDoW = U.dayOfWeek(now);

      let selWeek = view.selWeek;
      if (selWeek == null) selWeek = (todayWeek >= 1 && todayWeek <= rec.totalWeeks) ? todayWeek : 1;
      selWeek = Math.min(Math.max(selWeek, 1), rec.totalWeeks);
      view.selWeek = selWeek;

      /* ---------- 骨架 ---------- */
      const v = App.el('div', 'view');
      v.innerHTML =
        '<div class="toolbar">' +
        '<div class="week-nav">' +
        '<button class="nav-btn" id="ttPrev" type="button" title="上一周">' +
        '<img src="icons/arrow_left.png" class="ico" alt="上一周"></button>' +
        '<div class="week-label">第 <span id="ttWeekNum"></span> 周<span id="ttWeekBadge"></span></div>' +
        '<button class="nav-btn" id="ttNext" type="button" title="下一周">' +
        '<img src="icons/arrow_right.png" class="ico" alt="下一周"></button></div>' +
        '<button class="btn-today" id="ttToday" type="button">回到本周</button>' +
        '<div class="spacer"></div>' +
        '<button class="btn-add" id="ttAdd" type="button">' +
        '<img src="icons/add.png" class="ico ico-white" alt="">添加课程</button>' +
        '</div>' +
        '<div class="grid-wrap"><div class="grid" id="ttGrid"></div></div>';
      root.appendChild(v);

      const grid = v.querySelector('#ttGrid');

      /* ---------- 缩放（双指捏合） ---------- */
      if (view.zoom == null) view.zoom = 1;
      function applyZoom() {
        grid.style.zoom = view.zoom;
      }
      function pinchDist(t) {
        const dx = t[0].clientX - t[1].clientX;
        const dy = t[0].clientY - t[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
      }
      let pinch = null;
      const gw = v.querySelector('.grid-wrap');
      gw.addEventListener('touchstart', function (e) {
        if (e.touches.length === 2) pinch = { d: pinchDist(e.touches), zoom: view.zoom };
      }, { passive: false });
      gw.addEventListener('touchmove', function (e) {
        if (e.touches.length === 2 && pinch && pinch.d > 0) {
          view.zoom = Math.min(1.6, Math.max(0.6, +(pinch.zoom * pinchDist(e.touches) / pinch.d).toFixed(2)));
          applyZoom();
          e.preventDefault();
        }
      }, { passive: false });
      gw.addEventListener('touchend', function (e) {
        if (e.touches.length < 2) pinch = null;
      });
      gw.addEventListener('touchcancel', function () { pinch = null; });

      /* ---------- 构建网格骨架（表头 + 节次格 + 空白格） ---------- */
      function buildGrid() {
        grid.innerHTML = '';
        grid.style.gridTemplateRows = '40px repeat(' + rec.periodsPerDay + ', var(--row-h))';
        DAY_HEADS.forEach(function (h, i) {
          const el = App.el('div', 'gh' +
            (selWeek === todayWeek && i === todayDoW ? ' today' : ''), h);
          el.style.gridColumn = (i + 1) + ' / ' + (i + 2);
          el.style.gridRow = '1 / 2';
          grid.appendChild(el);
        });
        for (let p = 1; p <= rec.periodsPerDay; p++) {
          const lab = App.el('div', 'gp');
          const bell = U.bellOf(rec.bells, p);
          lab.innerHTML = '第<br>' + p + '<br>节' + (bell && bell.s ? '<span class="gp-t">' + bell.s + '</span>' : '');
          lab.style.gridColumn = '1 / 2';
          lab.style.gridRow = (p + 1) + ' / ' + (p + 2);
          grid.appendChild(lab);
          for (let d = 1; d <= 7; d++) {
            (function (day, period) {
              const cell = App.el('div', 'gc');
              cell.style.gridColumn = (day + 1) + ' / ' + (day + 2);
              cell.style.gridRow = (period + 1) + ' / ' + (period + 2);
              cell.title = '在 周' + ['一', '二', '三', '四', '五', '六', '日'][day - 1] + ' 第' + period + '节 添加课程';
              cell.addEventListener('click', function () { openCourse(null, day, period); });
              grid.appendChild(cell);
            })(d, p);
          }
        }
      }

      /* ---------- 渲染周次信息 + 课程块 ---------- */
      function renderCourses() {
        v.querySelector('#ttWeekNum').textContent = selWeek;
        const isOdd = U.weekTypeOf(selWeek) === 'odd';
        const badge = v.querySelector('#ttWeekBadge');
        badge.textContent = isOdd ? '单周' : '双周';
        badge.className = 'badge ' + (isOdd ? 'odd' : 'even');

        grid.querySelectorAll('.course').forEach(function (n) { n.remove(); });
        courses.forEach(function (c) {
          if (!U.courseVisible(c, selWeek)) return;
          if (c.startPeriod > rec.periodsPerDay) return;
          const ep = Math.min(c.endPeriod, rec.periodsPerDay);
          const block = App.el('div', 'course');
          block.style.gridColumn = (c.day + 1) + ' / ' + (c.day + 2);
          block.style.gridRow = (c.startPeriod + 1) + ' / ' + (ep + 2); // 连堂沿网格线跨多行
          block.style.background = colorOf(c.name);
          block.title = '双击编辑 / 删除';
          block.innerHTML =
            '<span class="c-name">' + App.esc(c.name) + '</span>' +
            '<span class="c-meta">@' + App.esc(c.place || '未填地点') + '</span>' +
            (c.teacher ? '<span class="c-meta">' + App.esc(c.teacher) + '</span>' : '');
          block.addEventListener('dblclick', function () { openCourse(c); });
          // 单击课程块不触发编辑（仅双击）；阻止落到下层空白格
          block.addEventListener('click', function (e) { e.stopPropagation(); });
          grid.appendChild(block);
        });
      }

      async function refresh() {
        rec = await Store.currentSchoolRecord();
        courses = await Store.listCourses(school);
        selWeek = Math.min(Math.max(selWeek, 1), rec.totalWeeks);
        view.selWeek = selWeek;
        renderCourses();
      }

      /* ---------- 添加 / 编辑课程弹窗 ---------- */
      function openCourse(editC, day, period) {
        const isEdit = !!editC;
        const c = isEdit ? editC : {
          name: '', place: '', teacher: '',
          day: day || todayDoW,
          startPeriod: period || 1, endPeriod: period || 1,
          startWeek: (day ? selWeek : selWeek), endWeek: rec.totalWeeks, weekType: 'all'
        };
        const body =
          '<div class="form-grid">' +
          '<div class="field full"><label>课程名 <b>*</b></label>' +
          '<input type="text" id="f_name" placeholder="如：高等数学" maxlength="40"></div>' +
          '<div class="field"><label>上课地点</label><input type="text" id="f_place" placeholder="如：教三-302" maxlength="40"></div>' +
          '<div class="field"><label>任课老师</label><input type="text" id="f_teacher" placeholder="如：王老师" maxlength="40"></div>' +
          '<div class="field"><label>星期几 <b>*</b></label><select id="f_day">' +
          [1, 2, 3, 4, 5, 6, 7].map(function (d) {
            return '<option value="' + d + '">周' + ['一', '二', '三', '四', '五', '六', '日'][d - 1] + '</option>';
          }).join('') + '</select></div>' +
          '<div class="field"><label>起始节次 <b>*</b></label><input type="number" id="f_startp" min="1" max="' + rec.periodsPerDay + '" value="1"></div>' +
          '<div class="field"><label>结束节次 <b>*</b></label><input type="number" id="f_endp" min="1" max="' + rec.periodsPerDay + '" value="2"></div>' +
          '<div class="field"><label>起始周 <b>*</b></label><input type="number" id="f_startw" min="1" max="' + rec.totalWeeks + '" value="1"></div>' +
          '<div class="field"><label>结束周 <b>*</b></label><input type="number" id="f_endw" min="1" max="' + rec.totalWeeks + '" value="' + rec.totalWeeks + '"></div>' +
          '<div class="field full"><label>周次类型 <b>*</b></label>' +
          '<div class="radio-row">' +
          '<label><input type="radio" name="wtype" value="all"> 全周（每周都上）</label>' +
          '<label><input type="radio" name="wtype" value="odd"> 仅单周</label>' +
          '<label><input type="radio" name="wtype" value="even"> 仅双周</label></div>' +
          '<span class="hint">单周＝奇数周（1、3、5…），双周＝偶数周（2、4、6…）；连堂课把结束节次设为最后一节即可。</span></div>' +
          '</div>';
        const cfg = App.modal({
          title: isEdit ? '编辑课程' : '添加课程', body: body,
          buttons: [
            { label: '删除该课程', type: 'danger', onClick: function () { return doDelete(cfg); } },
            { label: '取消', onClick: function () {} },
            { label: '保存', type: 'primary', onClick: function () { return doSave(cfg); } }
          ]
        });
        const r = cfg.root;
        r.querySelector('#f_name').value = c.name || '';
        r.querySelector('#f_place').value = c.place || '';
        r.querySelector('#f_teacher').value = c.teacher || '';
        r.querySelector('#f_day').value = c.day;
        r.querySelector('#f_startp').value = c.startPeriod;
        r.querySelector('#f_endp').value = c.endPeriod;
        r.querySelector('#f_startw').value = c.startWeek;
        r.querySelector('#f_endw').value = c.endWeek;
        const wt = c.weekType === 'odd' || c.weekType === 'even' ? c.weekType : 'all';
        r.querySelector('input[name=wtype][value="' + wt + '"]').checked = true;
        r.querySelector('.btn-danger').style.display = isEdit ? '' : 'none';
        setTimeout(function () { r.querySelector('#f_name').focus(); }, 60);

        async function doSave() {
          const name = r.querySelector('#f_name').value.trim();
          if (!name) { App.toast('请填写课程名', 'err'); return false; }
          const day = parseInt(r.querySelector('#f_day').value, 10);
          const sp = parseInt(r.querySelector('#f_startp').value, 10);
          const ep = parseInt(r.querySelector('#f_endp').value, 10);
          const sw = parseInt(r.querySelector('#f_startw').value, 10);
          const ew = parseInt(r.querySelector('#f_endw').value, 10);
          const wtype = r.querySelector('input[name=wtype]:checked').value;
          if (!(sp >= 1 && sp <= rec.periodsPerDay) || !(ep >= 1 && ep <= rec.periodsPerDay)) {
            App.toast('节次需在 1 到 ' + rec.periodsPerDay + ' 之间', 'err'); return false;
          }
          if (ep < sp) { App.toast('结束节次不能早于起始节次', 'err'); return false; }
          if (!(sw >= 1 && sw <= rec.totalWeeks) || !(ew >= 1 && ew <= rec.totalWeeks)) {
            App.toast('周次需在 1 到 ' + rec.totalWeeks + ' 之间', 'err'); return false; }
          if (ew < sw) { App.toast('结束周不能早于起始周', 'err'); return false; }
          const data = {
            name: name, place: r.querySelector('#f_place').value.trim(),
            teacher: r.querySelector('#f_teacher').value.trim(),
            day: day, startPeriod: sp, endPeriod: ep, startWeek: sw, endWeek: ew, weekType: wtype
          };
          if (isEdit) { await Store.updateCourse(editC.id, data); App.toast('已保存修改', 'ok'); }
          else { await Store.addCourse(school, data); App.toast('已添加课程', 'ok'); }
          await refresh();
        }

        async function doDelete() {
          const ok = await App.confirm('确定删除课程「' + editC.name + '」吗？', { title: '删除课程', okText: '删除' });
          if (!ok) return false;
          await Store.deleteCourse(editC.id);
          App.toast('已删除课程', 'ok');
          await refresh();
        }
      }

      /* ---------- 工具条事件 ---------- */
      v.querySelector('#ttPrev').addEventListener('click', function () {
        if (selWeek > 1) { selWeek--; view.selWeek = selWeek; renderCourses(); }
      });
      v.querySelector('#ttNext').addEventListener('click', function () {
        if (selWeek < rec.totalWeeks) { selWeek++; view.selWeek = selWeek; renderCourses(); }
      });
      v.querySelector('#ttToday').addEventListener('click', function () {
        let w = todayWeek;
        if (w < 1) w = 1;
        if (w > rec.totalWeeks) w = rec.totalWeeks;
        selWeek = w; view.selWeek = selWeek; renderCourses();
        if (todayWeek < 1) App.toast('尚未开学，已定位到第 1 周');
        else if (todayWeek > rec.totalWeeks) App.toast('本学期课表已结束，已定位到最后一周');
      });
      v.querySelector('#ttAdd').addEventListener('click', function () { openCourse(null); });

      buildGrid();
      renderCourses();
      applyZoom();

      // 从首页跳转过来时，直接打开对应课程的详情
      const pd = App.pendingDetail;
      if (pd && pd.type === 'course') {
        App.pendingDetail = null;
        const hit = courses.filter(function (x) { return x.id === pd.id; })[0];
        if (hit) App.openCourseDetail(hit);
        else App.toast('未找到该课程', 'err');
      }
    }
  };

  global.App.views.timetable = view;
})(window);
