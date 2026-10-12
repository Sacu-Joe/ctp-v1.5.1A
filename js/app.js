/* ============================================================
 * app.js — 应用外壳：左侧导航 / 视图路由 / 通用弹窗 / 学校管理 / 全局设置
 * 依赖：window.Store（数据层）、window.U（工具）。视图注册到 window.App.views。
 * 纯原生 JS，普通 <script> 加载，无需构建。
 * ============================================================ */
(function (global) {
  'use strict';

  const App = {
    state: { school: null, schoolRec: null, current: 'home' },
    views: {},

    // 功能模块（首页为默认仪表盘，不在此列；点击“首页”回首页）
    modules: [
      { key: 'schedule', name: '日程', icon: 'module_schedule', dev: false },
      { key: 'timetable', name: '课程表', icon: 'module_timetable', dev: false },
      { key: 'activity', name: '活动', icon: 'module_activity', dev: false },
      { key: 'notes', name: '课堂笔记', icon: 'module_notes', dev: false }
    ],

    // 活动六类配色（与桌面版一致）
    ACTIVITY_COLOR: {
      '社团': '#0d9488', '比赛': '#dc2626', '讲座': '#7c3aed',
      '志愿实践': '#16a34a', '文体活动': '#d97706', '其他': '#64748b'
    },

    VERSION: 'v1.5.1A',
    // 鸣谢名单（来自桌面 thanks.txt，离线内置）
    THANKS: '策划：Scau\n\n开发：Scau\n\n辅助开发工具：豆包v2pro、DeepSeek v4 pro\n\n测试：Scau、BiscuitOvO、Rain',
    // 使用说明（离线内置，首次启动自动弹出，也可在「设置 → 通用」查看）
    USAGE: `校园任务平台  使用说明

【多学校】
· 「设置 → 通用 → 学校管理」可新建 / 切换 / 删除学校；
  课表、活动、笔记按学校隔离，日程为全局共用。

【首页】
显示今日剩余课程（最多 5 节）与今日活动；点课程卡片进入课程表。

【日程】
· 左上 ▸/▾ 折叠或展开日历（默认折叠）。
· 当天列表同时显示：用户自定义 + 当天课程 + 当天活动。
· 右上「新建日程」添加；双击卡片编辑；勾选标记完成；「删除」移除。
· 「同步课表和活动」：把课程表与活动一起导出到系统日历。
· 保存日程后 5 秒内若不再保存，会自动导出一次日历文件。

【课程表】
· 顶部 ◀ ▶ 切换教学周，「回到本周」快速定位；自动判断单周 / 双周。
· 单击空白格＝按该天该节新增课程；双击课程块＝编辑或删除。
· 双指捏合可缩放课表。
· 课表设置（总周数 / 每天节数 / 开学日 / 每节作息）在「设置 → 课表」，支持导入别人分享的课表数据。

【活动】
· 卡片墙 / 列表 / 日历三种视图，可一键切换。
· 「新建活动」添加；双击卡片编辑或删除。
· 已结束活动自动归档；「历史记录」可查看并导出 txt。

【课堂笔记】
· 顶部「列表 / 编辑」切换；列表可搜索、按科目筛选。
· 编辑器支持加粗 / 斜体 / 下划线 / 字号 / 颜色 / 对齐 / 列表 / 插图；编辑后自动保存。
· 双指捏合可缩放编辑区。
· 导出 / 导入 PDF：在「设置 → 课堂笔记」。

【到点提醒（导出到系统日历）】
· 打开「设置 → 日程 → 日程到点提醒」，输入提前多少分钟，导出 .ics 文件。
· 用系统「日历」打开该文件，点「添加全部」即可，由日历按时提醒（因此需要用户保留系统日历并且正确设置允许通知）。
· 文件已含日程、课程与活动；重复导入按同一事件更新，不会重复添加。

【数据与备份】
· 数据保存在本机，清除浏览器数据会丢失。
· 请定期在「设置 → 通用 → 导出备份」保存，换机时用「导入备份」恢复。

版本号：v1.5.1A
Scau
26.10.12`
  };

  /* ---------------- 基础 helper ---------------- */
  App.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  App.icon = function (file, cls) {
    return '<img src="icons/' + file + '.png" class="ico ' + (cls || '') + '" alt="">';
  };
  App.$ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  App.el = function (tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };

  /* ---------------- Toast ---------------- */
  App.toast = function (msg, type) {
    let layer = document.getElementById('toastLayer');
    if (!layer) { layer = App.el('div', ''); layer.id = 'toastLayer'; document.body.appendChild(layer); }
    const t = App.el('div', 'toast' + (type ? ' ' + type : ''), App.esc(msg));
    layer.appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 1900);
    setTimeout(function () { t.remove(); }, 2300);
  };

  /* ---------------- 通用弹窗 ----------------
   * opts: { title, body(HTML 字符串), buttons:[{label,type:'primary'|'danger'|'',onClick(cfg)}] }
   * onClick 返回 false（或 resolve false）则不自动关闭；抛错会弹 toast 且不关闭。
   * 返回 cfg={ root, mask, close() } */
  App.modal = function (opts) {
    const mask = App.el('div', 'mask');
    const m = App.el('div', 'modal');
    const footHtml = (opts.buttons && opts.buttons.length)
      ? '<div class="modal-foot"></div>' : '';
    m.innerHTML =
      '<div class="modal-head"><h2>' + App.esc(opts.title || '') + '</h2>' +
      '<button class="modal-x" type="button" aria-label="关闭">&times;</button></div>' +
      '<div class="modal-body">' + (opts.body || '') + '</div>' + footHtml;
    mask.appendChild(m);
    document.body.appendChild(mask);
    const cfg = {
      root: m, mask: mask,
      close: function () {
        mask.classList.remove('show');
        setTimeout(function () { mask.remove(); }, 160);
      }
    };
    m.querySelector('.modal-x').addEventListener('click', cfg.close);
    mask.addEventListener('click', function (e) { if (e.target === mask) cfg.close(); });
    const foot = m.querySelector('.modal-foot');
    if (foot) {
      opts.buttons.forEach(function (b) {
        const cls = 'btn' + (b.type === 'primary' ? ' btn-primary' : b.type === 'danger' ? ' btn-danger' : '');
        const btn = App.el('button', cls, App.esc(b.label));
        btn.type = 'button';
        btn.addEventListener('click', async function () {
          try {
            const r = b.onClick ? await b.onClick(cfg) : true;
            if (r !== false) cfg.close();
          } catch (err) { App.toast(err && err.message ? err.message : '操作失败', 'err'); }
        });
        foot.appendChild(btn);
      });
    }
    requestAnimationFrame(function () { mask.classList.add('show'); });
    return cfg;
  };

  // 确认框，返回 Promise<boolean>
  App.confirm = function (msg, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      const body = '<p style="line-height:1.8;font-size:14px;white-space:pre-wrap;">' +
        App.esc(msg) + '</p>';
      const cfg = App.modal({
        title: opts.title || '请确认', body: body,
        buttons: [
          { label: '取消', onClick: function () { resolve(false); } },
          { label: opts.okText || '确定', type: 'primary', onClick: function () { resolve(true); } }
        ]
      });
      cfg.mask.addEventListener('click', function (e) { if (e.target === cfg.mask) resolve(false); });
    });
  };

  /* ---------------- 活动卡片（首页 / 后续活动模块复用） ---------------- */
  App.activityCard = function (a) {
    const color = App.ACTIVITY_COLOR[a.type] || App.ACTIVITY_COLOR['其他'];
    let timeHtml;
    if (U.timeToSec(a.start) !== null) {
      const e = U.timeToSec(a.end) !== null ? a.end : '';
      timeHtml = '🕒 ' + App.esc(a.start + (e ? ' – ' + e : ''));
    } else {
      timeHtml = '<span class="a-allday">🕒 全天</span>';
    }
    const card = App.el('div', 'acard');
    card.style.borderLeftColor = color;
    card.innerHTML =
      '<div class="a-top"><span class="a-name">' + App.esc(a.name) + '</span>' +
      '<span class="a-type" style="background:' + color + '1a;color:' + color + '">' +
      App.esc(a.type || '其他') + '</span></div>' +
      '<div class="a-row">' + timeHtml + '</div>' +
      '<div class="a-row">📍 ' + App.esc(a.place || '地点待定') + '</div>';
    return card;
  };

  /* ---------------- 导航 ---------------- */
  App.renderNav = function () {
    const nav = document.getElementById('nav');
    nav.innerHTML = '';
    App.modules.forEach(function (m) {
      const item = App.el('div', 'nav-item' + (App.state.current === m.key ? ' active' : '') +
        (m.dev ? ' dev' : ''));
      item.innerHTML = (m.dev ? '<span class="dev-mini">开发中</span>' : '') +
        '<div class="nav-ico">' + App.icon(m.icon) + '</div>' +
        '<div class="nav-name">' + App.esc(m.name) + '</div>';
      item.addEventListener('click', function () { App.go(m.key); });
      nav.appendChild(item);
    });
    // 底部“首页”的高亮（首页不在 modules 列表内，单独切换）
    const home = document.getElementById('brandHome');
    if (home) home.classList.toggle('active', App.state.current === 'home');
  };

  App.refreshChrome = async function () {
    App.state.school = await Store.currentSchool();
    App.state.schoolRec = await Store.currentSchoolRecord();
    document.getElementById('schoolName').textContent = App.state.school;
  };

  App.renderDate = function () {
    const n = new Date();
    const wk = ['日', '一', '二', '三', '四', '五', '六'];
    document.getElementById('dateText').textContent =
      n.getFullYear() + '年' + (n.getMonth() + 1) + '月' + n.getDate() + '日 星期' + wk[n.getDay()];
  };

  /* ---------------- 路由 ---------------- */
  App.go = async function (key) {
    App.state.current = key;
    App.renderNav();
    const root = document.getElementById('viewRoot');
    root.innerHTML = '';

    let title = '你好';
    if (key !== 'home') {
      const mod = App.modules.find(function (m) { return m.key === key; });
      title = mod ? mod.name : '';
    }
    document.getElementById('viewTitle').textContent = title;

    const v = App.views[key];
    if (v) { await v.mount(root); return; }

    // 未完成模块：占位页
    const mod = App.modules.find(function (m) { return m.key === key; });
    if (mod) {
      const ph = App.el('div', 'placeholder');
      ph.innerHTML = App.icon(mod.icon) +
        '<div class="ph-name">' + App.esc(mod.name) + '</div>' +
        '<div class="ph-msg">该功能开发中...</div>';
      root.appendChild(ph);
    }
  };

  /* ---------------- 学校管理 ---------------- */
  App.openSchools = async function () {
    const body =
      '<div class="school-add">' +
      '<input type="text" id="newSchoolName" placeholder="输入新学校名称，如：第一中学" maxlength="40">' +
      '<button id="btnNewSchool" type="button">＋ 新建学校</button></div>' +
      '<div class="school-list" id="schoolList"></div>' +
      '<span style="display:block;margin-top:12px;font-size:11px;color:#9aa4b1;line-height:1.7;">' +
      '每个学校的课表、活动、笔记与图片相互独立，保存在本机数据库中；点选某所学校即可切换。' +
      '删除学校会一并删除其全部数据，且至少保留一所学校。</span>';
    const cfg = App.modal({
      title: '学校管理', body: body,
      buttons: [{ label: '完成', type: 'primary' }]
    });
    const list = cfg.root.querySelector('#schoolList');
    const inp = cfg.root.querySelector('#newSchoolName');

    const render = async function () {
      const all = await Store.listSchools();
      const cur = await Store.currentSchool();
      list.innerHTML = '';
      if (!all.length) { list.innerHTML = '<div class="school-empty">暂无学校，请先新建</div>'; return; }
      all.forEach(function (s) {
        const active = s.name === cur;
        const item = App.el('div', 'school-item' + (active ? ' active' : ''));
        item.innerHTML =
          '<span class="s-name">' + App.esc(s.name) + '</span>' +
          (active
            ? '<span class="s-tag">当前使用</span><span class="s-pick">✓</span>'
            : '<span class="s-pick">点击切换</span>') +
          '<button class="s-del" type="button" title="删除该校">删除</button>';
        item.addEventListener('click', function (e) {
          if (e.target.classList.contains('s-del')) return;
          if (!active) {
            Store.setCurrentSchool(s.name).then(function () {
              App.toast('已切换到「' + s.name + '」', 'ok');
              return App.onSchoolChanged();
            }).then(render).catch(function (err) { App.toast(err.message, 'err'); });
          }
        });
        item.querySelector('.s-del').addEventListener('click', function (e) {
          e.stopPropagation();
          (async function () {
            const all2 = await Store.listSchools();
            if (all2.length <= 1) { App.toast('至少需要保留一所学校', 'err'); return; }
            const ok = await App.confirm(
              '确定删除「' + s.name + '」及其全部课表、活动、笔记与图片吗？此操作不可恢复。',
              { title: '删除学校', okText: '删除' });
            if (!ok) return;
            await Store.deleteSchool(s.name);
            App.toast('已删除学校', 'ok');
            await App.onSchoolChanged();
            await render();
          })().catch(function (err) { App.toast(err.message, 'err'); });
        });
        list.appendChild(item);
      });
    };
    await render();

    const create = async function () {
      const raw = inp.value.trim();
      if (!raw) { App.toast('请输入学校名称', 'err'); return; }
      try {
        const name = await Store.addSchool(raw);
        inp.value = '';
        App.toast('已新建并切换到「' + name + '」', 'ok');
        await App.onSchoolChanged();
        await render();
      } catch (err) { App.toast(err.message, 'err'); }
    };
    cfg.root.querySelector('#btnNewSchool').addEventListener('click', create);
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') create(); });
  };

  // 切换 / 新建 / 删除学校后：刷新顶栏并重新挂载当前视图
  App.onSchoolChanged = async function () {
    await App.refreshChrome();
    await App.go(App.state.current);
  };

  /* ---------------- 使用说明（首次启动弹出；readme.txt 内置） ---------------- */
  App.openUsage = function () {
    const content = App.USAGE && App.USAGE.trim() ? App.USAGE : '（暂无使用说明）';
    App.modal({
      title: '使用说明',
      body: '<pre class="about-thanks usage-body">' + App.esc(content) + '</pre>',
      buttons: [{ label: '知道了', type: 'primary' }]
    });
  };

  /* ---------------- 设置分组折叠 ---------------- */
  App.sec = function (title, innerHtml) {
    const sec = App.el('div', 'set-sec');
    const head = App.el('div', 'set-sec-head',
      '<span class="set-sec-title">' + App.esc(title) + '</span><span class="set-sec-caret">▾</span>');
    const body = App.el('div', 'set-sec-body', innerHtml);
    sec.appendChild(head); sec.appendChild(body);
    head.addEventListener('click', function () {
      body.classList.toggle('open');
      head.querySelector('.set-sec-caret').textContent = body.classList.contains('open') ? '▴' : '▾';
    });
    return sec;
  };

  // 渲染「每一节作息时间」编辑行
  App.renderBells = function (container, bells, count) {
    container.innerHTML = '';
    for (let i = 1; i <= count; i++) {
      const b = (bells && bells[i - 1]) || { s: '', e: '' };
      const row = App.el('div', 'bell-row');
      row.innerHTML =
        '<span class="bell-label">第 ' + i + ' 节</span>' +
        '<input type="time" class="bell-s" value="' + App.esc(b.s || '') + '">' +
        '<span class="bell-dash">–</span>' +
        '<input type="time" class="bell-e" value="' + App.esc(b.e || '') + '">';
      container.appendChild(row);
    }
  };
  App.collectBells = function (container) {
    const out = [];
    container.querySelectorAll('.bell-row').forEach(function (row) {
      out.push({ s: row.querySelector('.bell-s').value, e: row.querySelector('.bell-e').value });
    });
    return out;
  };

  /* ---------------- 全局设置（分组折叠：日程 / 课表 / 通用） ---------------- */
  App.openSettings = async function () {
    const remind = await Store.scheduleRemindEnabled();
    const rec = await Store.currentSchoolRecord();
    const school = App.state.school;

    const cfg = App.modal({
      title: '设置', body: '<div class="set-groups"></div>',
      buttons: [{ label: '关闭', type: 'primary' }]
    });
    const r = cfg.root;
    const groups = r.querySelector('.set-groups');

    /* ---- 日程 ---- */
    const schedInner =
      '<div class="set-row"><div class="set-t"><b>日程到点提醒</b>' +
      '<span>开启后把「日程」导出到系统日历，由系统日历提醒。</span></div>' +
      '<label class="switch"><input type="checkbox" id="setRemind" ' + (remind ? 'checked' : '') + '><span class="slider"></span></label></div>' +
      '<div class="set-actions"><button class="btn" id="setManualExport" type="button">手动导出</button></div>';
    groups.appendChild(App.sec('日程', schedInner));

    /* ---- 课表 ---- */
    const ttInner =
      '<div class="field full"><label>本学期总教学周数</label>' +
      '<input type="number" id="tt_totalweeks" min="1" value="' + rec.totalWeeks + '"></div>' +
      '<div class="field full"><label>每天最大节数</label>' +
      '<input type="number" id="tt_periods" min="1" max="20" value="' + rec.periodsPerDay + '"></div>' +
      '<div class="field full"><label>第一周开学日期</label>' +
      '<input type="date" id="tt_firstdate" value="' + rec.firstDate + '"></div>' +
      '<div class="field full"><label>每一节作息时间</label><div id="tt_bells" class="bells-editor"></div></div>' +
      '<div class="set-actions">' +
      '<button class="btn btn-primary" id="ttSave" type="button">保存课表</button>' +
      '<button class="btn" id="ttImportPreset" type="button">导入预设课表</button>' +
      '<button class="btn" id="ttExportPreset" type="button">导出课表信息</button>' +
      '<input type="file" id="ttPresetFile" accept="application/json,.json" style="display:none">' +
      '</div>';
    groups.appendChild(App.sec('课表', ttInner));

    /* ---- 课堂笔记（PDF 导入 / 导出） ---- */
    const notesInner =
      '<div class="set-actions" style="flex-direction:column;align-items:stretch;">' +
      '<button class="btn" id="notesPdfExport" type="button">导出笔记 PDF</button>' +
      '<button class="btn" id="notesPdfImport" type="button">导入笔记 PDF</button>' +
      '<input type="file" id="notesPdfFile" accept="application/pdf,.pdf" style="display:none">' +
      '</div>';
    groups.appendChild(App.sec('课堂笔记', notesInner));

    /* ---- 通用 ---- */
    const commonInner =
      '<div class="set-actions" style="flex-direction:column;align-items:stretch;">' +
      '<button class="btn" id="setSchools" type="button">学校管理（切换 / 新建 / 删除）</button>' +
      '<button class="btn" id="setAbout" type="button">关于</button>' +
      '<button class="btn" id="setUsage" type="button">使用说明</button>' +
      '<button class="btn" id="setExport" type="button">导出备份</button>' +
      '<button class="btn" id="setImport" type="button">导入备份</button>' +
      '<button class="btn btn-danger" id="setReset" type="button">清空并重置</button>' +
      '<input type="file" id="setImportFile" accept="application/json,.json" style="display:none">' +
      '</div>';
    groups.appendChild(App.sec('通用', commonInner));

    /* ---- 事件：日程 ---- */
    r.querySelector('#setRemind').addEventListener('change', async function (e) {
      const on = e.target.checked;
      if (on) {
        const done = await App.exportSchedulesToCalendar();
        if (done) await Store.setScheduleRemindEnabled(true);
        else e.target.checked = false;
      } else {
        await Store.setScheduleRemindEnabled(false);
        App.toast('已关闭提醒（如需完全停止，请到系统日历中删除对应日程）', 'ok');
      }
    });
    r.querySelector('#setManualExport').addEventListener('click', function () {
      App.exportSchedulesToCalendar();
    });

    /* ---- 事件：课表 ---- */
    const bellsBox = r.querySelector('#tt_bells');
    const periodsInp = r.querySelector('#tt_periods');
    let curBells = (rec.bells || []).slice();
    App.renderBells(bellsBox, curBells, rec.periodsPerDay);
    periodsInp.addEventListener('change', function () {
      const pp = Math.min(20, Math.max(1, parseInt(periodsInp.value, 10) || 1));
      curBells = App.collectBells(bellsBox);      // 先保留用户已编辑的作息
      curBells = U.ensureBells(curBells, pp);
      App.renderBells(bellsBox, curBells, pp);
    });

    r.querySelector('#ttSave').addEventListener('click', async function () {
      const tw = parseInt(r.querySelector('#tt_totalweeks').value, 10);
      const pp = parseInt(periodsInp.value, 10);
      const fd = r.querySelector('#tt_firstdate').value;
      if (!(tw >= 1)) { App.toast('总教学周数至少为 1', 'err'); return; }
      if (!(pp >= 1 && pp <= 20)) { App.toast('每天节次数需在 1–20 之间', 'err'); return; }
      if (!U.parseDate(fd)) { App.toast('请选择有效的开学日期', 'err'); return; }
      await Store.saveTimetableSettings(school, {
        totalWeeks: tw, periodsPerDay: pp, firstDate: fd,
        bells: App.collectBells(bellsBox)
      });
      App.toast('课表设置已保存', 'ok');
      await App.go(App.state.current);
    });

    const presetFile = r.querySelector('#ttPresetFile');
    r.querySelector('#ttImportPreset').addEventListener('click', function () { presetFile.click(); });
    presetFile.addEventListener('change', async function () {
      const f = presetFile.files[0];
      presetFile.value = '';
      if (!f) return;
      try {
        const obj = JSON.parse(await f.text());
        if (!obj || obj.format !== 'campus-platform.timetable.v1') throw new Error('不是有效的课表预设文件');
        const tw = parseInt(obj.totalWeeks, 10);
        const pp = parseInt(obj.periodsPerDay, 10);
        if (!(tw >= 1) || !(pp >= 1 && pp <= 20)) throw new Error('预设中的周数或节次数不合法');
        await Store.saveTimetableSettings(school, {
          totalWeeks: tw, periodsPerDay: pp,
          firstDate: obj.firstDate || rec.firstDate,
          bells: Array.isArray(obj.bells) ? obj.bells : []
        });
        App.toast('预设课表已导入', 'ok');
        await App.go(App.state.current);
        cfg.close();
      } catch (err) { App.toast(err.message || '导入失败', 'err'); }
    });
    r.querySelector('#ttExportPreset').addEventListener('click', async function () {
      const cur = await Store.currentSchoolRecord();
      const payload = {
        format: 'campus-platform.timetable.v1',
        totalWeeks: cur.totalWeeks, periodsPerDay: cur.periodsPerDay,
        firstDate: cur.firstDate, bells: cur.bells
      };
      U.downloadText('课表预设-' + school + '.json', JSON.stringify(payload, null, 2),
        'application/json;charset=utf-8');
      App.toast('已导出课表预设', 'ok');
    });

    /* ---- 事件：课堂笔记 PDF ---- */
    const notesPdfFile = r.querySelector('#notesPdfFile');
    r.querySelector('#notesPdfExport').addEventListener('click', async function () {
      let count = 0;
      try { count = (await Store.listNotes(school)).length; } catch (e) { /* 忽略 */ }
      if (!count) { App.toast('当前学校还没有笔记', 'err'); return; }
      const cfg2 = App.modal({
        title: '导出笔记 PDF',
        body:
          '<p style="font-size:13px;color:var(--sub);line-height:1.8;margin-bottom:12px;">请选择导出方式：</p>' +
          '<div class="set-actions" style="flex-direction:column;align-items:stretch;">' +
          '<button class="btn btn-primary" id="pdfShare" type="button">分享 PDF（可再导入、无损）</button>' +
          '<button class="btn" id="pdfPlain" type="button">普通 PDF 文档（打印/另存，便于查看）</button>' +
          '</div>' +
          '<p style="font-size:12px;color:#9aa4b1;line-height:1.7;margin-top:12px;">' +
          '· <b>分享 PDF</b>：把笔记数据内嵌进 PDF，可在本应用「导入笔记 PDF」完整还原，适合备份与传递。<br>' +
          '· <b>普通 PDF</b>：像 Word 转 PDF，调起系统打印后选「存储为 PDF」，得到便于阅读的文件（不能再导入）。</p>',
        buttons: [{ label: '取消' }]
      });
      cfg2.root.querySelector('#pdfShare').addEventListener('click', async function () {
        cfg2.close();
        try {
          const blob = await Pdf.exportNotes(school);
          U.downloadBlob('课堂笔记-' + school + '-' + U.todayStr() + '.pdf', blob);
          App.toast('已导出分享 PDF', 'ok');
        } catch (e) { App.toast(e.message || '导出失败', 'err'); }
      });
      cfg2.root.querySelector('#pdfPlain').addEventListener('click', function () {
        cfg2.close();
        App.printNotes(school);
      });
    });
    r.querySelector('#notesPdfImport').addEventListener('click', function () { notesPdfFile.click(); });
    notesPdfFile.addEventListener('change', async function () {
      const f = notesPdfFile.files[0];
      notesPdfFile.value = '';
      if (!f) return;
      try {
        const ok = await App.confirm('导入 PDF 将覆盖当前学校的全部笔记，确定吗？',
          { title: '导入 PDF', okText: '导入' });
        if (!ok) return;
        const payload = await Pdf.importNotes(f);
        await Store.importNotesPayload(school, payload);
        App.toast('笔记导入成功', 'ok');
        await App.go(App.state.current);
      } catch (e) { App.toast(e.message || '导入失败', 'err'); }
    });

    /* ---- 事件：通用 ---- */
    r.querySelector('#setSchools').addEventListener('click', function () { cfg.close(); App.openSchools(); });
    r.querySelector('#setAbout').addEventListener('click', function () { App.openAbout(); });
    r.querySelector('#setUsage').addEventListener('click', function () { App.openUsage(); });
    r.querySelector('#setExport').addEventListener('click', function () {
      const nameBody =
        '<div class="field full"><label>备份文件名</label>' +
        '<input type="text" id="setExportName" maxlength="80" value="' +
        App.esc('校园任务平台备份-' + U.todayStr() + '.json') + '">' +
        '<span class="hint">可自定义文件名，导出为 JSON 格式。</span></div>';
      const ec = App.modal({
        title: '导出备份', body: nameBody,
        buttons: [
          { label: '取消', onClick: function () {} },
          { label: '导出', type: 'primary', onClick: async function () {
            let name = ec.root.querySelector('#setExportName').value.trim();
            if (!name) { App.toast('请输入文件名', 'err'); return false; }
            if (!/\.json$/i.test(name)) name += '.json';
            try {
              await Store.downloadBackup(name);
              App.toast('已导出备份文件', 'ok');
            } catch (err) { App.toast(err.message, 'err'); return false; }
          } }
        ]
      });
      setTimeout(function () {
        const inp = ec.root.querySelector('#setExportName');
        if (inp) { inp.focus(); inp.select(); }
      }, 60);
    });
    const file = r.querySelector('#setImportFile');
    r.querySelector('#setImport').addEventListener('click', function () { file.click(); });
    file.addEventListener('change', async function () {
      const f = file.files[0];
      if (!f) return;
      try {
        const text = await f.text();
        await Store.importData(text);
        App.toast('导入成功，正在重载…', 'ok');
        setTimeout(function () { location.reload(); }, 700);
      } catch (err) { App.toast(err.message, 'err'); }
    });
    r.querySelector('#setReset').addEventListener('click', async function () {
      const ok = await App.confirm(
        '将清空全部学校、课表、日程、活动、笔记与图片，并恢复为初始的「我的学校」。确定吗？',
        { title: '清空并重置', okText: '全部清空' });
      if (!ok) return;
      await Store.resetAll();
      App.toast('已重置，正在重载…', 'ok');
      setTimeout(function () { location.reload(); }, 700);
    });
  };

  /* ---------------- 关于 ---------------- */
  App.openAbout = function () {
    const body =
      '<div class="about-list">' +
      '<button class="btn about-btn" id="abVer" type="button">版本</button>' +
      '<button class="btn about-btn" id="abFeedback" type="button">反馈</button>' +
      '<button class="btn about-btn" id="abThanks" type="button">鸣谢</button>' +
      '</div>' +
      '<div class="about-result" id="abResult">点击上方按钮查看对应信息</div>';
    const cfg = App.modal({ title: '关于', body: body, buttons: [{ label: '关闭', type: 'primary' }] });
    const res = cfg.root.querySelector('#abResult');
    cfg.root.querySelector('#abVer').addEventListener('click', function () {
      res.innerHTML = '<div class="about-ver">' + App.esc(App.VERSION) + '</div>';
    });
    cfg.root.querySelector('#abFeedback').addEventListener('click', function () {
      res.textContent = 'QQ：3645318581';
    });
    cfg.root.querySelector('#abThanks').addEventListener('click', function () {
      res.innerHTML = '<pre class="about-thanks">' + App.esc(App.THANKS) + '</pre>';
    });
  };

  /* ---------------- 详情弹窗（活动 / 课程） ---------------- */
  function detailBody(titleHtml, tagHtml, color, rows) {
    return '<div class="detail-head"' + (color ? ' style="border-left-color:' + color + '"' : '') + '>' +
      '<div class="detail-title">' + titleHtml + '</div>' + (tagHtml || '') + '</div>' +
      '<div class="detail-list">' + rows.map(function (r) {
        return '<div class="detail-row"><span class="dr-k">' + App.esc(r[0]) + '</span>' +
          '<span class="dr-v">' + App.esc(r[1] == null ? '' : r[1]) + '</span></div>';
      }).join('') + '</div>';
  }

  App.openActivityDetail = function (a) {
    if (!a) return;
    const color = App.ACTIVITY_COLOR[a.type] || App.ACTIVITY_COLOR['其他'];
    const rows = [
      ['类型', a.type || '其他'],
      ['日期', a.date || ''],
      ['时间', U.timeToSec(a.start) === null ? '全天' : (a.start + (a.end ? ' – ' + a.end : ''))]
    ];
    if (a.place) rows.push(['地点', a.place]);
    if (a.organizer) rows.push(['组织者', a.organizer]);
    if (a.note) rows.push(['备注', a.note]);
    App.modal({
      title: '活动详情',
      body: detailBody(App.esc(a.name),
        '<span class="detail-tag" style="color:' + color + ';border-color:' + color + '">' +
        App.esc(a.type || '其他') + '</span>', color, rows),
      buttons: [{ label: '关闭', type: 'primary' }]
    });
  };

  App.openCourseDetail = function (c) {
    if (!c) return;
    const DAY = ['一', '二', '三', '四', '五', '六', '日'];
    const wt = c.weekType === 'odd' ? '仅单周' : c.weekType === 'even' ? '仅双周' : '每周';
    const rows = [
      ['星期', '周' + DAY[(c.day || 1) - 1]],
      ['节次', '第 ' + c.startPeriod + (c.endPeriod !== c.startPeriod ? '–' + c.endPeriod : '') + ' 节'],
      ['周次', '第 ' + c.startWeek + '–' + c.endWeek + ' 周 · ' + wt]
    ];
    const rec = App.state.schoolRec;
    if (rec) {
      const b1 = U.bellOf(rec.bells, c.startPeriod);
      const b2 = U.bellOf(rec.bells, c.endPeriod);
      if (b1 && b1.s) rows.splice(2, 0, ['时间', b1.s + (b2 && b2.e ? ' – ' + b2.e : '')]);
    }
    if (c.place) rows.push(['地点', c.place]);
    if (c.teacher) rows.push(['老师', c.teacher]);
    App.modal({
      title: '课程详情',
      body: detailBody(App.esc(c.name), '<span class="detail-tag">课程</span>', '#2563eb', rows),
      buttons: [{ label: '关闭', type: 'primary' }]
    });
  };

  // 首页点击后记录“要看哪一条”，由目标模块挂载时打开详情
  App.pendingDetail = null;

  /* ---------------- 图片放大查看（笔记插图双击） ---------------- */
  App.openImageZoom = function (src) {
    if (!src) return;
    const mask = App.el('div', 'imgzoom-mask');
    const img = App.el('img', 'imgzoom-img');
    img.src = src;
    mask.appendChild(img);
    mask.addEventListener('click', function () { mask.remove(); });
    document.body.appendChild(mask);
    requestAnimationFrame(function () { mask.classList.add('show'); });
  };

  /* ---------------- 普通 PDF（打印 / 另存为 PDF，便于查看） ----------------
   * 不在 PDF 内嵌数据，而是把笔记排成打印页交给系统「存储为 PDF」，
   * 中文与插图都能正常显示，效果类似 Word 转 PDF。 */
  App.printNotes = async function (school) {
    const notes = await Store.listNotes(school);
    if (!notes.length) { App.toast('当前学校还没有笔记', 'err'); return; }
    const urls = [];
    let html = '';
    for (const n of notes) {
      let rh = { html: U.sanitizeHtml(n.html || ''), urls: [] };
      try { rh = await Store.Images.resolveHtml(U.sanitizeHtml(n.html || '')); } catch (e) { /* 忽略 */ }
      urls.push.apply(urls, rh.urls);
      html += '<section class="print-note">' +
        '<h1 class="pn-title">' + App.esc(n.title || '未命名笔记') + '</h1>' +
        (n.subject ? '<div class="pn-sub">' + App.esc(n.subject) + '</div>' : '') +
        '<div class="pn-body">' + rh.html + '</div></section>';
    }
    const layer = App.el('div', 'print-layer');
    layer.innerHTML = html;
    document.body.appendChild(layer);
    document.body.classList.add('printing');
    let done = false;
    const cleanup = function () {
      if (done) return;
      done = true;
      if (layer.parentNode) layer.parentNode.removeChild(layer);
      document.body.classList.remove('printing');
      Store.Images.revokeUrls(urls);
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(function () {
      try { window.print(); } catch (e) { App.toast('无法调起打印：' + (e && e.message ? e.message : e), 'err'); }
      setTimeout(cleanup, 1500);
    }, 200);
  };

  /* ---------------- 日程 + 课程 + 活动 → 系统日历 ---------------- */
  // 汇总当前学校的日程、课程、活动与课表设置
  App.collectIcalData = async function () {
    const school = App.state.school;
    const schedules = await Store.listSchedules();
    const courses = await Store.listCourses(school);
    const activities = await Store.listActivities(school, false);
    const schoolRec = await Store.currentSchoolRecord();
    return { school: school, schedules: schedules, courses: courses, activities: activities, schoolRec: schoolRec };
  };

  function downloadIcs(ics) {
    U.downloadBlob('日程提醒-' + U.todayStr() + '.ics',
      new Blob([ics.text], { type: 'text/calendar;charset=utf-8' }));
  }

  // 保存日程后 5 秒内没有新的保存 → 自动导出 ics 到日历
  App.scheduleAutoExport = function () {
    if (App._autoExportTimer) clearTimeout(App._autoExportTimer);
    App._autoExportTimer = setTimeout(function () {
      App._autoExportTimer = null;
      App.autoExportSchedules();
    }, 5000);
  };

  // 静默自动导出（使用上次设定的提前分钟数）
  App.autoExportSchedules = async function () {
    try {
      let lead = parseInt(await Store.getSetting('leadMinutes', 15), 10);
      if (isNaN(lead) || lead < 0) lead = 15;
      const data = await App.collectIcalData();
      const ics = Ical.buildAll(data.schedules, {
        courses: data.courses, activities: data.activities,
        schoolRec: data.schoolRec, leadMinutes: lead
      });
      if (!ics.count) return;
      downloadIcs(ics);
      App.toast('已自动同步 ' + ics.count + ' 条到系统日历', 'ok');
    } catch (e) { /* 静默失败，不打扰 */ }
  };

  /* ---------------- 手动导出（含课程与活动） ----------------
   * 先询问“提前多少分钟提醒”（用户自行输入），再把日程 + 课程表 + 活动
   * 合并进一个 .ics（每条带 VALARM，TZID=Asia/Shanghai）下载，用户导入系统日历后，
   * 由系统日历在开始时间前弹出提醒。 */
  App.exportSchedulesToCalendar = function () {
    const body =
      '<div class="field full"><label>提前多少分钟提醒</label>' +
      '<input type="number" id="leadMin" min="0" max="1440" value="15">' +
      '<span class="hint">到达开始时间前提前多少分钟提醒（可输入任意分钟数）。将导出日程 + 课程表 + 活动。</span></div>';
    return new Promise(function (resolve) {
      const cfg = App.modal({
        title: '导出到系统日历', body: body,
        buttons: [
          { label: '取消', onClick: function () { resolve(false); } },
          { label: '导出', type: 'primary', onClick: async function () {
            const m = parseInt(cfg.root.querySelector('#leadMin').value, 10);
            if (isNaN(m) || m < 0) { App.toast('请输入有效的分钟数', 'err'); return false; }
            try {
              await Store.setSetting('leadMinutes', m);
              const data = await App.collectIcalData();
              const ics = Ical.buildAll(data.schedules, {
                courses: data.courses, activities: data.activities,
                schoolRec: data.schoolRec, leadMinutes: m
              });
              if (!ics.count) { App.toast('当前没有可导出的内容', 'err'); return false; }
              downloadIcs(ics);
              App.toast('已导出 ' + ics.count + ' 条（含课程与活动），请在系统日历中「添加全部」', 'ok');
              resolve(true);
            } catch (err) { App.toast(err.message || '导出失败', 'err'); return false; }
          } }
        ]
      });
      cfg.mask.addEventListener('click', function (e) { if (e.target === cfg.mask) resolve(false); });
      setTimeout(function () {
        const inp = cfg.root.querySelector('#leadMin');
        if (inp) { inp.focus(); inp.select(); }
      }, 60);
    });
  };

  /* ---------------- 启动 ---------------- */
  App.boot = async function () {
    try {
      await Store.init();
      await App.refreshChrome();
      App.renderDate();
      App.renderNav();
      document.getElementById('brandHome').addEventListener('click', function () { App.go('home'); });
      document.getElementById('btnGlobalSettings').addEventListener('click', function () { App.openSettings(); });
      await App.go('home');
      // 首次使用弹出「使用说明」
      const seen = await Store.getSetting('hasSeenIntro', false);
      if (!seen) {
        await Store.setSetting('hasSeenIntro', true);
        setTimeout(function () { App.openUsage(); }, 400);
      }
    } catch (e) {
      document.body.innerHTML =
        '<div style="padding:40px;font-family:sans-serif;color:#b91c1c;line-height:1.8;">' +
        '应用初始化失败：' + App.esc(e && e.message) + '<br>请刷新页面重试。</div>';
      console.error(e);
    }
  };

  global.App = App;
})(window);
