/* ============================================================
 * views/scores.js — 考试成绩模块（考试 × 科目双维度，数据按学校保存）
 *  · 「按考试看」：一场场考试卡片（最新在前），单击看详情：总分 / 总得分率 /
 *    平均得分率 / 最高最低科目 / 各科得分率横条 / 单科与总分排名；详情内可进入录入。
 *  · 「按科目看」：每个科目卡片（最新 / 平均 / 进退步），单击看历次成绩与
 *    得分率、班排 / 年排趋势折线（内置 SVG，零依赖）。
 *  · 新建 / 编辑考试：考试信息 + 整张科目成绩表一次录入（得分 / 满分 / 单科班排年排），
 *    底部实时统计；删除考试级联删除其成绩。
 *  · 教务网站自动导入：数据层已预留固定格式与 Provider 接口（Store.importScores），
 *    本版按约定不在界面暴露入口。
 * ============================================================ */
(function (global) {
  'use strict';

  const WK = ['日', '一', '二', '三', '四', '五', '六'];
  const EXAM_COLOR = {
    '月考': '#0d9488', '期中': '#2563eb', '期末': '#dc2626',
    '模拟考': '#d97706', '其他': '#64748b'
  };

  const view = {
    school: null,
    mode: 'exams',          // exams | subjects
    exams: [],              // 日期升序
    sumMap: {},             // examId -> examSummary
    subjects: [],
    subjMap: {}             // subject -> subjectTrend
  };

  function esc(s) { return App.esc(s); }
  function colorOf(t) { return EXAM_COLOR[t] || EXAM_COLOR['其他']; }
  function shortName(s) { s = String(s || ''); return s.length > 5 ? s.slice(0, 5) + '…' : s; }
  function weekText(s) {
    const d = U.parseDate(s);
    return d ? ((d.getMonth() + 1) + '/' + d.getDate() + ' 周' + WK[d.getDay()]) : (s || '');
  }
  function rateColor(rate) {
    if (rate == null) return '#cbd5e1';
    if (rate >= 90) return '#16a34a';
    if (rate >= 75) return '#0d9488';
    if (rate >= 60) return '#d97706';
    return '#dc2626';
  }
  function fmtRate(r) { return r == null ? '—' : (Math.round(r * 10) / 10 + '%'); }
  function rankLine(cls, grd) {
    const parts = [];
    if (cls != null) parts.push('班排 ' + cls);
    if (grd != null) parts.push('年排 ' + grd);
    return parts.length ? '🏆 ' + parts.join(' · ') : '';
  }

  /* ---------------- 内置 SVG 折线图（零依赖） ---------------- */
  function lineSVG(opts) {
    const W = opts.w || 560, H = opts.h || 240;
    const padL = 46, padR = 16, padT = 24, padB = 54;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const series = opts.series || [];
    let n = 1;
    series.forEach(function (s) { n = Math.max(n, s.pts.length); });
    const x = function (i) { return n <= 1 ? padL + plotW / 2 : padL + plotW * i / (n - 1); };
    const yMin = opts.yMin, yMax = opts.yMax;
    const y = function (v) {
      let t = (v - yMin) / (yMax - yMin);
      if (isNaN(t)) t = 0;
      if (opts.reverse) t = 1 - t;
      return padT + (1 - t) * plotH;
    };
    const fmt = opts.fmt || function (v) { return v; };
    let svg = '<svg class="gx-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">';
    (opts.ticks || [yMin, yMax]).forEach(function (tk) {
      const yy = y(tk);
      svg += '<line x1="' + padL + '" y1="' + yy + '" x2="' + (W - padR) + '" y2="' + yy + '" class="gx-grid"/>';
      svg += '<text x="' + (padL - 6) + '" y="' + (yy + 4) + '" text-anchor="end" class="gx-yt">' + esc(fmt(tk)) + '</text>';
    });
    const ref = series[0] ? series[0].pts : [];
    ref.forEach(function (p, i) {
      svg += '<text x="' + x(i) + '" y="' + (H - padB + 18) + '" text-anchor="middle" class="gx-xt">' +
        esc(shortName(p.label)) + '</text>';
    });
    series.forEach(function (s) {
      let seg = [];
      function drawPt(d) {
        svg += '<circle cx="' + x(d.i) + '" cy="' + y(d.value) + '" r="3.6" fill="' + s.color + '"/>';
        svg += '<text x="' + x(d.i) + '" y="' + (y(d.value) - 8) + '" text-anchor="middle" class="gx-vl" fill="' + s.color + '">' + esc(fmt(d.value)) + '</text>';
      }
      function drawSeg(arr) {
        svg += '<polyline points="' + arr.map(function (d) { return x(d.i) + ',' + y(d.value); }).join(' ') +
          '" fill="none" stroke="' + s.color + '" stroke-width="2"/>';
      }
      function flush() {
        if (seg.length >= 2) drawSeg(seg);
        seg.forEach(drawPt);
        seg = [];
      }
      s.pts.forEach(function (p, i) { if (p.value == null) flush(); else seg.push({ i: i, value: p.value }); });
      flush();
    });
    if (series.length > 1) {
      let lx = padL;
      series.forEach(function (s) {
        svg += '<rect x="' + lx + '" y="4" width="10" height="10" rx="2" fill="' + s.color + '"/>';
        svg += '<text x="' + (lx + 15) + '" y="13" class="gx-lg">' + esc(s.name) + '</text>';
        lx += 22 + s.name.length * 13 + 18;
      });
    }
    svg += '</svg>';
    return svg;
  }

  // 各科得分率横条（HTML）
  function barsHtml(rows) {
    const sorted = rows.slice().sort(function (a, b) {
      const ra = a.score != null ? a.score / a.maxScore : -1;
      const rb = b.score != null ? b.score / b.maxScore : -1;
      return rb - ra;
    });
    return sorted.map(function (r) {
      const rate = r.score != null ? r.score / r.maxScore * 100 : null;
      const col = rateColor(rate);
      const w = rate == null ? 0 : Math.max(2, rate);
      const val = r.score == null ? '未出分' : (r.score + ' / ' + r.maxScore + ' · ' + (Math.round(rate * 10) / 10) + '%');
      return '<div class="gx-bar">' +
        '<span class="gx-bar-name">' + esc(r.subject) + '</span>' +
        '<span class="gx-bar-track"><span class="gx-bar-fill" style="width:' + w + '%;background:' + col + '"></span></span>' +
        '<span class="gx-bar-val">' + esc(val) + '</span></div>';
    }).join('');
  }

  function statBox(label, value, sub, color) {
    return '<div class="gx-stat"><div class="gx-sv"' + (color ? ' style="color:' + color + '"' : '') + '>' +
      esc(value) + '</div><div class="gx-sl">' + esc(label) + '</div>' +
      (sub ? '<div class="gx-ss">' + esc(sub) + '</div>' : '') + '</div>';
  }

  view.mount = async function (root) {
    view.school = App.state.school;

    async function loadData() {
      view.exams = await Store.listExams(view.school);
      view.sumMap = {};
      for (const ex of view.exams) view.sumMap[ex.id] = await Store.examSummary(view.school, ex.id);
      view.subjects = await Store.scoreSubjects(view.school);
      view.subjMap = {};
      for (const s of view.subjects) view.subjMap[s] = await Store.subjectTrend(view.school, s);
    }
    await loadData();

    const v = App.el('div', 'view');
    v.innerHTML =
      '<div class="toolbar gx-toolbar"><div class="act-sub">' +
      '<div class="act-sub-t">考试成绩</div>' +
      '<div class="act-sub-s">按考试 / 按科目双维度查看；得分率按各科满分自动折算（数据按学校保存）</div></div>' +
      '<div class="spacer"></div>' +
      '<button class="btn-add" id="gxAdd" type="button">' + App.icon('add', 'ico-white') + '新建考试</button></div>' +
      '<div class="gx-viewbar"><span class="act-vlab">视图：</span>' +
      '<button class="gx-vbtn" id="gxVwExams" type="button">📝 按考试看</button>' +
      '<button class="gx-vbtn" id="gxVwSubjects" type="button">📚 按科目看</button></div>' +
      '<div class="gx-content">' +
      '<section class="gx-pane show" id="gxPaneExams"><div class="gx-cards" id="gxCards"></div></section>' +
      '<section class="gx-pane" id="gxPaneSubjects"><div class="gx-cards" id="gxSubjCards"></div></section>' +
      '</div>';
    root.appendChild(v);

    const cards = v.querySelector('#gxCards');
    const subjCards = v.querySelector('#gxSubjCards');

    /* ---------- 按考试看：卡片 ---------- */
    function buildExamCard(ex) {
      const s = view.sumMap[ex.id];
      const col = colorOf(ex.type);
      const card = App.el('div', 'gx-card');
      card.style.borderLeftColor = col;
      const rk = rankLine(ex.classRank, ex.gradeRank);
      card.innerHTML =
        '<div class="gx-top"><span class="gx-name">' + esc(ex.name) + '</span>' +
        '<span class="gx-tag" style="color:' + col + ';border-color:' + col + ';">' + esc(ex.type || '月考') + '</span></div>' +
        '<div class="gx-line">📅 ' + esc(weekText(ex.date)) + (ex.term ? '　🏷 ' + esc(ex.term) : '') + '</div>' +
        '<div class="gx-ratebox">' +
        '<div class="gx-rate" style="color:' + (s.rate == null ? '#9aa4b1' : rateColor(s.rate)) + '">' +
        fmtRate(s.rate) + '</div>' +
        '<div class="gx-total">' + (s.maxTotal > 0 ? '总分 ' + s.total + ' / ' + s.maxTotal : '暂无成绩') + '</div></div>' +
        (rk ? '<div class="gx-line">' + esc(rk) + '</div>' : '') +
        '<div class="gx-line gx-sub">' + s.count + ' 科' +
        (s.avgRate != null ? ' · 平均 ' + fmtRate(s.avgRate) : '') +
        (s.best ? ' · 最高 ' + esc(s.best.subject) : '') + (s.worst ? ' · 最低 ' + esc(s.worst.subject) : '') + '</div>' +
        '<div class="gx-hint">单击查看统计与录入 / 编辑</div>';
      card.addEventListener('click', function () { showExamDetail(ex); });
      return card;
    }
    function renderExams() {
      cards.innerHTML = '';
      if (!view.exams.length) {
        cards.appendChild(App.el('div', 'gx-empty', '暂无考试成绩\n点击右上角“新建考试”，录入一场考试与各科成绩'));
        return;
      }
      view.exams.slice().reverse().forEach(function (ex) { cards.appendChild(buildExamCard(ex)); });
    }

    /* ---------- 按科目看：卡片 ---------- */
    function buildSubjectCard(subject) {
      const t = view.subjMap[subject];
      const latest = t.latest;
      const rate = latest ? latest.rate : null;
      const col = rateColor(rate);
      const card = App.el('div', 'gx-card gx-subj-card');
      card.style.borderLeftColor = col;
      let delta = '';
      if (t.delta != null) {
        const up = t.delta >= 0;
        delta = '<div class="gx-line" style="color:' + (up ? '#16a34a' : '#dc2626') + '">' +
          (up ? '▲ 较上次 +' : '▼ 较上次 ') + t.delta + ' 个百分点</div>';
      }
      card.innerHTML =
        '<div class="gx-top"><span class="gx-name">' + esc(subject) + '</span>' +
        (rate != null ? '<span class="gx-tag" style="color:' + col + ';border-color:' + col + ';">最新 ' + fmtRate(rate) + '</span>' : '') +
        '</div>' +
        '<div class="gx-ratebox"><div class="gx-rate" style="color:' + col + '">' + fmtRate(rate) + '</div>' +
        '<div class="gx-total">' + (latest ? ('最新 ' + latest.score + ' / ' + latest.max) : '暂无成绩') + '</div></div>' +
        '<div class="gx-line gx-sub">' + t.count + ' 次考试' +
        (t.avg != null ? ' · 平均 ' + fmtRate(t.avg) : '') +
        (t.max ? ' · 最高 ' + fmtRate(t.max.rate) : '') + (t.min ? ' · 最低 ' + fmtRate(t.min.rate) : '') + '</div>' +
        delta +
        '<div class="gx-hint">单击查看历次趋势</div>';
      card.addEventListener('click', function () { showSubjectDetail(subject); });
      return card;
    }
    function renderSubjects() {
      subjCards.innerHTML = '';
      if (!view.subjects.length) {
        subjCards.appendChild(App.el('div', 'gx-empty', '暂无科目成绩\n请先在“按考试看”里新建考试并录入各科成绩'));
        return;
      }
      view.subjects.forEach(function (s) { subjCards.appendChild(buildSubjectCard(s)); });
    }
    function renderAll() { renderExams(); renderSubjects(); }
    async function refresh() { await loadData(); renderAll(); }
    function setMode(mode) {
      view.mode = mode;
      v.querySelector('#gxPaneExams').classList.toggle('show', mode === 'exams');
      v.querySelector('#gxPaneSubjects').classList.toggle('show', mode === 'subjects');
      v.querySelector('#gxVwExams').classList.toggle('active', mode === 'exams');
      v.querySelector('#gxVwSubjects').classList.toggle('active', mode === 'subjects');
    }

    /* ---------- 考试详情（只读统计 + 横条 + 单科表） ---------- */
    function showExamDetail(ex) {
      const s = view.sumMap[ex.id];
      const stats =
        statBox('总得分率', fmtRate(s.rate), s.maxTotal ? (s.total + ' / ' + s.maxTotal + ' 分') : '', rateColor(s.rate)) +
        statBox('平均得分率', fmtRate(s.avgRate), s.scoredCount + ' 科已出分') +
        statBox('班级名次', ex.classRank != null ? '第 ' + ex.classRank + ' 名' : '—') +
        statBox('年级名次', ex.gradeRank != null ? '第 ' + ex.gradeRank + ' 名' : '—') +
        statBox('最高分科目', s.best ? s.best.subject : '—', s.best ? fmtRate(s.best.rate) : '', '#16a34a') +
        statBox('最低分科目', s.worst ? s.worst.subject : '—', s.worst ? fmtRate(s.worst.rate) : '', '#dc2626');
      const rows = s.rows.length
        ? '<table class="gx-table"><thead><tr><th>科目</th><th>得分 / 满分</th><th>得分率</th><th>班排</th><th>年排</th></tr></thead><tbody>' +
          s.rows.map(function (r) {
            const rate = r.score != null ? r.score / r.maxScore * 100 : null;
            return '<tr><td>' + esc(r.subject) + '</td>' +
              '<td>' + (r.score == null ? '未出分' : (r.score + ' / ' + r.maxScore)) + '</td>' +
              '<td style="color:' + rateColor(rate) + ';font-weight:600">' + fmtRate(rate) + '</td>' +
              '<td>' + (r.classRank != null ? r.classRank : '—') + '</td>' +
              '<td>' + (r.gradeRank != null ? r.gradeRank : '—') + '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<div class="gx-empty" style="padding:24px 0">还没有录入任何科目成绩</div>';
      const body =
        '<div class="gx-meta">📅 ' + esc(weekText(ex.date)) + (ex.term ? '　🏷 ' + esc(ex.term) : '') +
        '　<span class="gx-tag" style="color:' + colorOf(ex.type) + ';border-color:' + colorOf(ex.type) + ';">' + esc(ex.type) + '</span></div>' +
        '<div class="gx-stats">' + stats + '</div>' +
        '<div class="gx-sec-t">各科得分率</div>' +
        (s.rows.length ? barsHtml(s.rows) : '<div class="gx-empty" style="padding:18px 0">暂无成绩</div>') +
        '<div class="gx-sec-t">单科成绩与排名</div>' + rows +
        (ex.note ? '<div class="gx-note">备注：' + esc(ex.note) + '</div>' : '');
      const cfg = App.modal({
        title: ex.name, body: body,
        buttons: [
          { label: '关闭' },
          {
            label: '录入 / 编辑成绩', type: 'primary',
            onClick: function () { setTimeout(function () { openExamDialog(ex); }, 190); return true; }
          }
        ]
      });
      cfg.root.classList.add('modal-lg');
    }

    /* ---------- 科目详情（趋势折线 + 历次表） ---------- */
    function showSubjectDetail(subject) {
      const t = view.subjMap[subject];
      const latest = t.latest;
      const stats =
        statBox('最新得分率', latest ? fmtRate(latest.rate) : '—', latest ? (latest.score + ' / ' + latest.max) : '', latest ? rateColor(latest.rate) : '') +
        statBox('平均', t.avg != null ? fmtRate(t.avg) : '—') +
        statBox('最高', t.max ? fmtRate(t.max.rate) : '—', t.max ? shortName(t.max.examName) : '', '#16a34a') +
        statBox('最低', t.min ? fmtRate(t.min.rate) : '—', t.min ? shortName(t.min.examName) : '', '#dc2626') +
        statBox('较上次', t.delta == null ? '—' : ((t.delta > 0 ? '+' : '') + t.delta + ' pp'),
          '', t.delta == null ? '' : (t.delta >= 0 ? '#16a34a' : '#dc2626'));
      const ratePts = t.points.map(function (p) { return { label: p.examName, value: p.rate }; });
      const hasRate = t.points.some(function (p) { return p.rate != null; });
      const rateChart = hasRate
        ? lineSVG({ yMin: 0, yMax: 100, ticks: [0, 25, 50, 75, 100], fmt: function (x) { return x + '%'; },
          series: [{ name: '得分率', color: '#0d9488', pts: ratePts }] })
        : '<div class="gx-empty" style="padding:20px 0">暂无已出分的成绩</div>';
      const rankVals = [];
      t.points.forEach(function (p) { if (p.classRank != null) rankVals.push(p.classRank); if (p.gradeRank != null) rankVals.push(p.gradeRank); });
      let rankChart = '<div class="gx-empty" style="padding:20px 0">未填写单科排名</div>';
      if (rankVals.length) {
        const yMax = Math.max(2, Math.max.apply(null, rankVals));
        rankChart = lineSVG({
          yMin: 1, yMax: yMax, ticks: [1, yMax], reverse: true, fmt: function (x) { return x; },
          series: [
            { name: '班排', color: '#0d9488', pts: t.points.map(function (p) { return { label: p.examName, value: p.classRank }; }) },
            { name: '年排', color: '#d97706', pts: t.points.map(function (p) { return { label: p.examName, value: p.gradeRank }; }) }
          ]
        });
      }
      const table = t.points.length
        ? '<table class="gx-table"><thead><tr><th>考试</th><th>日期</th><th>类型</th><th>得分 / 满分</th><th>得分率</th><th>班排</th><th>年排</th></tr></thead><tbody>' +
          t.points.slice().reverse().map(function (p) {
            return '<tr><td>' + esc(p.examName) + '</td><td>' + esc(weekText(p.date)) + '</td><td>' + esc(p.type || '') + '</td>' +
              '<td>' + (p.score == null ? '未出分' : (p.score + ' / ' + p.max)) + '</td>' +
              '<td style="color:' + rateColor(p.rate) + ';font-weight:600">' + fmtRate(p.rate) + '</td>' +
              '<td>' + (p.classRank != null ? p.classRank : '—') + '</td>' +
              '<td>' + (p.gradeRank != null ? p.gradeRank : '—') + '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<div class="gx-empty" style="padding:20px 0">暂无考试记录</div>';
      const body =
        '<div class="gx-stats">' + stats + '</div>' +
        '<div class="gx-sec-t">得分率趋势（按满分折算，可跨满分比较）</div>' + rateChart +
        '<div class="gx-sec-t">单科排名趋势（名次越小越靠前）</div>' + rankChart +
        '<div class="gx-sec-t">历次成绩</div>' + table;
      const cfg = App.modal({
        title: '科目 · ' + subject, body: body,
        buttons: [{ label: '关闭', type: 'primary' }]
      });
      cfg.root.classList.add('modal-lg');
    }

    /* ---------- 新建 / 编辑考试 + 录入成绩（大弹窗） ---------- */
    async function openExamDialog(edit) {
      const isEdit = !!edit;
      const courses = await Store.listCourses(view.school);
      const subjSuggest = Array.from(new Set(
        courses.map(function (c) { return c.name; }).filter(Boolean).concat(view.subjects)
      )).sort(function (a, b) { return a.localeCompare(b, 'zh'); });
      const termSuggest = Array.from(new Set(
        view.exams.map(function (e) { return e.term; }).filter(Boolean)
      ));
      const d0 = isEdit ? edit : {
        name: '', date: U.todayStr(), type: '月考', term: '', classRank: null, gradeRank: null, note: ''
      };
      let initRows = [];
      if (isEdit) {
        const exist = await Store.listScoresForExam(view.school, edit.id);
        initRows = exist.map(function (r) {
          return { subject: r.subject, score: r.score == null ? '' : r.score, maxScore: r.maxScore,
            cls: r.classRank == null ? '' : r.classRank, grd: r.gradeRank == null ? '' : r.gradeRank };
        });
      }
      initRows.push({ subject: '', score: '', maxScore: 100, cls: '', grd: '' });

      const typeOpts = U.EXAM_TYPES.map(function (t) {
        return '<option value="' + esc(t) + '">' + esc(t) + '</option>';
      }).join('');
      const body =
        '<div class="form-grid">' +
        '<div class="field"><label>考试名称 <b>*</b></label><input type="text" id="f_e_name" maxlength="40" placeholder="如：高一上期中考试"></div>' +
        '<div class="field"><label>考试日期 <b>*</b></label><input type="date" id="f_e_date"></div>' +
        '<div class="field"><label>类型</label><select id="f_e_type">' + typeOpts + '</select></div>' +
        '<div class="field"><label>学期 / 学年分组</label><input type="text" id="f_e_term" list="gxTermList" maxlength="30" placeholder="如：高一上"></div>' +
        '<datalist id="gxTermList">' + termSuggest.map(function (t) { return '<option value="' + esc(t) + '">'; }).join('') + '</datalist>' +
        '<div class="field"><label>班级名次（可空）</label><input type="number" id="f_e_cls" min="1" step="1" placeholder="如 5"></div>' +
        '<div class="field"><label>年级名次（可空）</label><input type="number" id="f_e_grd" min="1" step="1" placeholder="如 42"></div>' +
        '<div class="field full"><label>备注</label><textarea id="f_e_note" rows="2" maxlength="200" placeholder="可选"></textarea></div>' +
        '</div>' +
        '<div class="gx-sec-t">科目成绩（得分留空表示该科暂未出分；科目名为空的行将被忽略）</div>' +
        '<datalist id="gxSubjList">' + subjSuggest.map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist>' +
        '<div class="gx-row gx-row-head"><span>科目</span><span>得分</span><span>满分</span><span>班排</span><span>年排</span><span></span></div>' +
        '<div id="gxRows"></div>' +
        '<button type="button" class="gx-addrow" id="gxAddRow">＋ 添加科目</button>' +
        '<div class="gx-live" id="gxLive"></div>';

      const cfg = App.modal({
        title: isEdit ? ('编辑考试 · ' + edit.name) : '新建考试', body: body,
        buttons: [
          { label: '删除考试', type: 'danger', onClick: function () { return doDelete(); } },
          { label: '取消', onClick: function () {} },
          { label: '保存', type: 'primary', onClick: function () { return doSave(); } }
        ]
      });
      cfg.root.classList.add('modal-lg');
      const r = cfg.root;
      const nameI = r.querySelector('#f_e_name'), dateI = r.querySelector('#f_e_date'),
        typeI = r.querySelector('#f_e_type'), termI = r.querySelector('#f_e_term'),
        clsI = r.querySelector('#f_e_cls'), grdI = r.querySelector('#f_e_grd'), noteI = r.querySelector('#f_e_note'),
        rowsBox = r.querySelector('#gxRows'), live = r.querySelector('#gxLive');

      nameI.value = d0.name || '';
      dateI.value = d0.date;
      typeI.value = U.EXAM_TYPES.indexOf(d0.type) >= 0 ? d0.type : '月考';
      termI.value = d0.term || '';
      clsI.value = d0.classRank == null ? '' : d0.classRank;
      grdI.value = d0.gradeRank == null ? '' : d0.gradeRank;
      noteI.value = d0.note || '';
      r.querySelector('.btn-danger').style.display = isEdit ? '' : 'none';

      function addRow(data) {
        data = data || { subject: '', score: '', maxScore: 100, cls: '', grd: '' };
        const row = App.el('div', 'gx-row');
        row.innerHTML =
          '<input class="gx-in gx-rsubj" type="text" list="gxSubjList" maxlength="20" placeholder="科目">' +
          '<input class="gx-in gx-rscore" type="number" min="0" step="any" placeholder="得分">' +
          '<input class="gx-in gx-rmax" type="number" min="1" step="any" placeholder="满分">' +
          '<input class="gx-in gx-rcls" type="number" min="1" step="1" placeholder="班排">' +
          '<input class="gx-in gx-rgrd" type="number" min="1" step="1" placeholder="年排">' +
          '<button type="button" class="gx-rdel" title="删除该行">×</button>';
        const q = function (s) { return row.querySelector(s); };
        q('.gx-rsubj').value = data.subject;
        q('.gx-rscore').value = data.score === null || data.score === undefined ? '' : data.score;
        q('.gx-rmax').value = data.maxScore || 100;
        q('.gx-rcls').value = data.cls;
        q('.gx-rgrd').value = data.grd;
        q('.gx-rdel').addEventListener('click', function () { row.remove(); calcLive(); });
        row.querySelectorAll('input').forEach(function (inp) { inp.addEventListener('input', calcLive); });
        rowsBox.appendChild(row);
        calcLive();
      }
      initRows.forEach(addRow);
      r.querySelector('#gxAddRow').addEventListener('click', function () { addRow(); });

      function collectRows() {
        const out = [];
        const seen = {};
        rowsBox.querySelectorAll('.gx-row').forEach(function (row) {
          const subject = row.querySelector('.gx-rsubj').value.trim();
          if (!subject) return; // 空科目行忽略
          const scoreRaw = row.querySelector('.gx-rscore').value.trim();
          const maxRaw = row.querySelector('.gx-rmax').value.trim();
          const max = maxRaw === '' ? 100 : Number(maxRaw);
          const score = scoreRaw === '' ? null : Number(scoreRaw);
          if (!(max > 0)) throw new Error('「' + subject + '」满分必须大于 0');
          if (score != null && (isNaN(score) || score < 0 || score > max))
            throw new Error('「' + subject + '」得分须为 0~' + max + ' 之间的数字');
          const key = subject.toLowerCase();
          if (seen[key]) throw new Error('科目「' + subject + '」重复，请合并');
          seen[key] = 1;
          out.push({
            subject: subject, score: score, maxScore: max,
            classRank: row.querySelector('.gx-rcls').value.trim(),
            gradeRank: row.querySelector('.gx-rgrd').value.trim()
          });
        });
        return out;
      }
      function calcLive() {
        let total = 0, maxTotal = 0, rated = 0, rateSum = 0, best = null, worst = null;
        let n = 0;
        rowsBox.querySelectorAll('.gx-row').forEach(function (row) {
          const subject = row.querySelector('.gx-rsubj').value.trim();
          if (!subject) return;
          n++;
          const scoreRaw = row.querySelector('.gx-rscore').value.trim();
          const maxRaw = row.querySelector('.gx-rmax').value.trim();
          const score = scoreRaw === '' ? null : Number(scoreRaw);
          const max = maxRaw === '' ? 100 : Number(maxRaw);
          if (score != null && max > 0 && score >= 0 && score <= max) {
            total += score; maxTotal += max;
            const rate = score / max * 100; rateSum += rate; rated++;
            if (!best || rate > best.rate) best = { subject: subject, rate: rate };
            if (!worst || rate < worst.rate) worst = { subject: subject, rate: rate };
          }
        });
        const rate = maxTotal > 0 ? Math.round(total / maxTotal * 1000) / 10 : null;
        const avg = rated ? Math.round(rateSum / rated * 10) / 10 : null;
        live.innerHTML =
          '<span>已填 <b>' + n + '</b> 科（<b>' + rated + '</b> 科出分）</span>' +
          '<span>总分 <b>' + Math.round(total * 100) / 100 + '</b> / ' + maxTotal + '</span>' +
          '<span>总得分率 <b style="color:' + rateColor(rate) + '">' + fmtRate(rate) + '</b></span>' +
          '<span>平均 <b>' + fmtRate(avg) + '</b></span>' +
          (best ? '<span>最高 <b style="color:#16a34a">' + esc(best.subject) + ' ' + fmtRate(best.rate) + '</b></span>' : '') +
          (worst ? '<span>最低 <b style="color:#dc2626">' + esc(worst.subject) + ' ' + fmtRate(worst.rate) + '</b></span>' : '');
      }

      async function doSave() {
        const name = nameI.value.trim();
        if (!name) { App.toast('请填写考试名称', 'err'); return false; }
        if (!U.parseDate(dateI.value)) { App.toast('请选择有效考试日期', 'err'); return false; }
        const rows = collectRows();   // 非法时抛错，由弹窗统一 toast 且不关闭
        const examData = {
          name: name, date: dateI.value, type: typeI.value, term: termI.value.trim(),
          classRank: clsI.value.trim(), gradeRank: grdI.value.trim(), note: noteI.value.trim()
        };
        let examId;
        if (isEdit) { await Store.updateExam(edit.id, examData); examId = edit.id; }
        else { const rec = await Store.addExam(view.school, examData); examId = rec.id; }
        await Store.replaceExamScores(view.school, examId, rows);
        App.toast(isEdit ? '已保存考试成绩' : '已添加考试', 'ok');
        await refresh();
      }
      async function doDelete() {
        const ok = await App.confirm('确定删除考试「' + edit.name + '」及其全部 ' +
          (view.sumMap[edit.id] ? view.sumMap[edit.id].count : 0) + ' 科成绩吗？此操作不可恢复。',
          { title: '删除考试', okText: '删除' });
        if (!ok) return false;
        await Store.deleteExam(edit.id);
        App.toast('已删除考试', 'ok');
        await refresh();
      }

      setTimeout(function () { nameI.focus(); }, 60);
    }

    /* ---------- 事件 ---------- */
    v.querySelector('#gxAdd').addEventListener('click', function () { openExamDialog(null); });
    v.querySelector('#gxVwExams').addEventListener('click', function () { setMode('exams'); });
    v.querySelector('#gxVwSubjects').addEventListener('click', function () { setMode('subjects'); });

    renderAll();
    setMode(view.mode);
  };

  global.App.views.scores = view;
})(window);
