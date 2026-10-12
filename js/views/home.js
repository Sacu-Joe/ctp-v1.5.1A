/* ============================================================
 * views/home.js — 首页仪表盘
 * 左侧导航之外的右侧主区：今日课程（积木，最多 5 节，统一卡片 / 75% 透明）
 * 与今日活动（卡片堆叠，当日全部）。进入首页时先自动归档已结束活动。
 * ============================================================ */
(function (global) {
  'use strict';

  global.App.views.home = {
    async mount(root) {
      const school = App.state.school;
      const now = new Date();

      // 与桌面版一致：进入首页时自动把已结束活动归档
      try { await Store.archivePast(school, now); } catch (e) { /* 忽略归档异常 */ }

      const rec = await Store.currentSchoolRecord();
      const [courses, activities] = await Promise.all([
        Store.upcomingCoursesToday(school, 5, now),
        Store.activitiesForDate(school, U.todayStr(now), false)
      ]);
      const view = App.el('div', 'view');
      view.innerHTML =
        '<div class="dash">' +
        '<section class="panel"><div class="panel-head">' +
        '<span class="pt">📖 今日课程</span><span class="ps">当天接下来 · 最多 5 节</span></div>' +
        '<div class="panel-body" id="hCourses"></div></section>' +
        '<section class="panel"><div class="panel-head">' +
        '<span class="pt">🎉 今日活动</span><span class="ps">当日全部活动</span></div>' +
        '<div class="panel-body" id="hActs"></div></section>' +
        '</div>';
      root.appendChild(view);

      /* --- 今日课程：积木堆叠（统一大小 / 颜色，75% 透明） --- */
      const cb = view.querySelector('#hCourses');
      if (!courses.length) {
        cb.innerHTML = '<div class="empty">今天没有剩余课程了 🎉</div>';
      }
      courses.forEach(function (c) {
        const sb = U.bellOf(rec.bells, c.startPeriod);
        const eb = U.bellOf(rec.bells, c.endPeriod);
        const span = (c.endPeriod > c.startPeriod) ? ('-' + c.endPeriod) : '';
        const time = (sb ? sb.s : '--:--') + ' – ' + (eb ? eb.e : '--:--') +
          '（第' + c.startPeriod + span + '节）';
        const b = App.el('div', 'block');
        b.innerHTML =
          '<div class="studs"><i></i><i></i><i></i></div>' +
          '<div class="b-name">' + App.esc(c.name) + '</div>' +
          '<div class="b-row">🕒 ' + App.esc(time) + '</div>' +
          '<div class="b-row">📍 ' + App.esc(c.place || '未填地点') + '</div>';
        b.title = '点击查看课程详情（跳到课程表）';
        b.addEventListener('click', function () {
          App.pendingDetail = { type: 'course', id: c.id };
          App.go('timetable');
        });
        cb.appendChild(b);
      });

      /* --- 今日活动：卡片堆叠（当日全部） --- */
      const ab = view.querySelector('#hActs');
      if (!activities.length) {
        ab.innerHTML = '<div class="empty">今天暂无活动</div>';
      }
      activities.forEach(function (a) {
        const card = App.activityCard(a);
        card.style.cursor = 'pointer';
        card.title = '点击查看活动详情（跳到活动模块）';
        card.addEventListener('click', function () {
          App.pendingDetail = { type: 'activity', id: a.id };
          App.go('activity');
        });
        ab.appendChild(card);
      });
    }
  };
})(window);
