/* ============================================================
 * selftest.js — 数据层自检（页面打开即自动运行；headless 下据此判定 PASS/FAIL）
 * ============================================================ */
(function () {
  'use strict';

  // 1×1 PNG（用于验证二进制 Blob 的存取、备份 base64 编解码）
  const PNG_DATAURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  const logEl = document.getElementById('log');
  const sumEl = document.getElementById('summary');
  let pass = 0, fail = 0;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  }
  function line(text, cls) {
    logEl.innerHTML += '<span class="' + (cls || '') + '">' + esc(text) + '</span>\n';
  }
  function group(t) {
    logEl.innerHTML += '<span class="grp">▶ ' + esc(t) + '</span>\n';
  }
  async function ok(name, cond, detail) {
    if (cond) { pass++; line('  ✓ ' + name, 'ok'); }
    else { fail++; line('  ✗ ' + name + (detail ? '   → ' + detail : ''), 'bad'); }
  }
  async function throws(name, fn, re) {
    let t = false, msg = '';
    try { await fn(); } catch (e) { t = true; msg = e.message || String(e); }
    ok(name, t && (!re || re.test(msg)), t ? ('抛出：' + msg) : '期望抛异常但没有');
  }

  async function runAll() {
    pass = 0; fail = 0;
    logEl.textContent = '';
    sumEl.className = '';
    sumEl.textContent = '运行中…';
    document.body.dataset.result = 'running';

    try {
      const SCH = '我的学校';
      const today = U.todayStr();
      const tomorrow = U.dateStr(U.addDays(new Date(), 1));

      /* 1. 首启 */
      group('1. 初始化与首启种子');
      await Store.resetAll();
      let schools = await Store.listSchools();
      ok('首启自动创建 1 所学校', schools.length === 1, '实际 ' + schools.length);
      ok('默认学校名为“我的学校”', schools[0] && schools[0].name === '我的学校');
      ok('当前学校=我的学校', (await Store.currentSchool()) === '我的学校');
      const s0 = await Store.getSchool(SCH);
      ok('总周数 20', s0.totalWeeks === 20);
      ok('每天 10 节', s0.periodsPerDay === 10);
      ok('作息钟点 10 条', s0.bells.length === 10, '实际 ' + (s0.bells ? s0.bells.length : 0));
      ok('第1节 08:00-08:45', s0.bells[0].s === '08:00' && s0.bells[0].e === '08:45');
      ok('开学日=本周一', s0.firstDate === U.dateStr(U.mondayOfWeek(new Date())), s0.firstDate);
      ok('日程提醒默认开启', (await Store.scheduleRemindEnabled()) === true);

      /* 2. 设置 */
      group('2. 全局设置 kv');
      await Store.setScheduleRemindEnabled(false);
      ok('可关闭提醒', (await Store.scheduleRemindEnabled()) === false);
      await Store.setScheduleRemindEnabled(true);
      await Store.setSetting('foo', { a: 1, b: ['x'] });
      const fv = await Store.getSetting('foo');
      ok('自定义键值可存取对象', !!fv && fv.a === 1 && fv.b[0] === 'x');
      ok('缺失键返回默认值', (await Store.getSetting('nope', 42)) === 42);

      /* 3. 学校 */
      group('3. 学校新建 / 切换 / 校验 / 级联删除');
      await Store.addSchool('第二中学');
      ok('新建后共 2 所', (await Store.listSchools()).length === 2);
      ok('新建后自动切换到新学校', (await Store.currentSchool()) === '第二中学');
      await throws('重名报错', () => Store.addSchool('第二中学'), /已存在/);
      await throws('空白名报错', () => Store.addSchool('   '), /不能为空/);
      const cleanName = await Store.addSchool('a/b:c?');
      ok('学校名非法字符替换为 _', cleanName === 'a_b_c_', cleanName);
      await Store.setCurrentSchool('第二中学');
      await Store.deleteSchool('a_b_c_');
      ok('删除测试学校后剩 2 所', (await Store.listSchools()).length === 2);
      await Store.addCourse('第二中学', { name: '临时课' });
      await Store.addActivity('第二中学', { name: '临时活动', date: today });
      await Store.putNote('第二中学', { title: '临时笔记', html: '<p>x</p>' });
      const tmpImg = await Store.Images.put('第二中学', U.dataURLToBlob(PNG_DATAURL));
      await Store.deleteSchool('第二中学');
      ok('删除学校后剩 1 所', (await Store.listSchools()).length === 1);
      ok('级联删除课程', (await Store.listCourses('第二中学')).length === 0);
      ok('级联删除活动', (await Store.listActivities('第二中学', true)).length === 0);
      ok('级联删除笔记', (await Store.listNotes('第二中学')).length === 0);
      ok('级联删除图片', (await Store.Images.getBlob(tmpImg)) === null);
      ok('当前学校自动切回我的学校', (await Store.currentSchool()) === '我的学校');
      await throws('至少保留一所学校', () => Store.deleteSchool(SCH), /至少需要保留/);

      /* 4. 课程 / 教学周 / 单双周 / 连堂 */
      group('4. 课程 / 教学周 / 单双周 / 连堂');
      const tt = await Store.getSchool(SCH);
      const mon = U.parseDate(tt.firstDate);
      await Store.addCourse(SCH, { name: '高等数学', place: 'A101', teacher: '张老师', day: 1, startPeriod: 1, endPeriod: 2, startWeek: 1, endWeek: 16, weekType: 'all' });
      await Store.addCourse(SCH, { name: '单周讲座', place: 'C301', teacher: '李', day: 3, startPeriod: 5, endPeriod: 5, startWeek: 1, endWeek: 16, weekType: 'odd' });
      await Store.addCourse(SCH, { name: '双周实验', place: 'D401', teacher: '王', day: 4, startPeriod: 3, endPeriod: 4, startWeek: 1, endWeek: 16, weekType: 'even' });
      ok('开学当周=第 1 周', U.weekNumberOf(tt.firstDate, mon) === 1);
      ok('7 天后=第 2 周', U.weekNumberOf(tt.firstDate, U.addDays(mon, 7)) === 2);
      ok('开学前=0（未开学）', U.weekNumberOf(tt.firstDate, U.addDays(mon, -7)) === 0);
      const monCourses = await Store.coursesForDate(SCH, mon);
      ok('周一有 1 门课', monCourses.length === 1, '实际 ' + monCourses.length);
      ok('周一为高等数学', monCourses[0] && monCourses[0].name === '高等数学');
      ok('连堂 endPeriod=2', monCourses[0] && monCourses[0].endPeriod === 2);
      const wed1 = U.addDays(mon, 2), wed2 = U.addDays(mon, 9);
      ok('第1周(单)周三见单周课', (await Store.coursesForDate(SCH, wed1)).some(c => c.name === '单周讲座'));
      ok('第2周(双)周三不见单周课', !(await Store.coursesForDate(SCH, wed2)).some(c => c.name === '单周讲座'));
      const thu1 = U.addDays(mon, 3), thu2 = U.addDays(mon, 10);
      ok('第1周(单)周四不见双周课', !(await Store.coursesForDate(SCH, thu1)).some(c => c.name === '双周实验'));
      ok('第2周(双)周四见双周课', (await Store.coursesForDate(SCH, thu2)).some(c => c.name === '双周实验'));
      const early = new Date(mon); early.setHours(7, 0, 0, 0);
      const late = new Date(mon); late.setHours(9, 45, 0, 0);
      ok('07:00 高数未上完(1 节)', (await Store.upcomingCoursesToday(SCH, 5, early)).length === 1);
      ok('09:45 高数已结束(0 节)', (await Store.upcomingCoursesToday(SCH, 5, late)).length === 0);
      const bell = await Store.bellOf(SCH, 2);
      ok('第2节 08:55-09:40', bell.s === '08:55' && bell.e === '09:40');
      ok('越界节次返回 null', (await Store.bellOf(SCH, 99)) === null);
      const upd = await Store.updateCourse(monCourses[0].id, { place: 'B202' });
      ok('更新课程地点', upd.place === 'B202');
      await Store.deleteCourse((await Store.listCourses(SCH)).find(c => c.name === '单周讲座').id);
      ok('删除单周课后剩 2 门', (await Store.listCourses(SCH)).length === 2);

      /* 5. 日程 */
      group('5. 日程（全局）增删改 / 完成 / 提醒判定');
      const hw = await Store.addSchedule({ title: '交作业', date: today, start: '10:00', end: '11:00', note: '数学' });
      await Store.addSchedule({ title: '明天的事', date: tomorrow, start: '' });
      ok('今日清单 1 条', (await Store.listByDate(today)).length === 1);
      await Store.setScheduleDone(hw.id, true);
      ok('勾选完成', (await Store.listSchedules()).find(x => x.id === hw.id).done === true);
      await Store.updateSchedule(hw.id, { note: '已改' });
      ok('更新备注', (await Store.listSchedules()).find(x => x.id === hw.id).note === '已改');
      const remind = await Store.addSchedule({ title: '该提醒了', date: today, start: '00:01' });
      const atNight = new Date(U.parseDate(today)); atNight.setHours(23, 0, 0, 0);
      let due = await Store.dueSchedules(atNight);
      ok('到点未完成日程进入提醒', due.some(x => x.id === remind.id));
      ok('已完成日程不提醒', !due.some(x => x.id === hw.id));
      await Store.markScheduleReminded(remind.id);
      due = await Store.dueSchedules(atNight);
      ok('提醒过的不重复提醒', !due.some(x => x.id === remind.id));
      await Store.deleteSchedule(hw.id);
      ok('删除日程', !(await Store.listSchedules()).some(x => x.id === hw.id));

      /* 6. 活动 / 归档 */
      group('6. 活动数据 / 自动归档 / 历史文本');
      const yesterday = U.dateStr(U.addDays(new Date(), -1));
      await Store.addActivity(SCH, { name: '昨天全天招新', date: yesterday, start: '', end: '', type: '社团', place: '广场' });
      await Store.addActivity(SCH, { name: '今早例会', date: today, start: '07:00', end: '07:30', type: '社团' });
      const futureAct = await Store.addActivity(SCH, { name: '明天讲座', date: tomorrow, start: '09:00', end: '10:30', type: '讲座' });
      await Store.addActivity(SCH, { name: '今晚晚会', date: today, start: '23:30', end: '23:59', type: '文体活动' });
      const noon = new Date(U.parseDate(today)); noon.setHours(12, 0, 0, 0);
      const arc = await Store.archivePast(SCH, noon);
      ok('归档 2 个已结束活动', arc.count === 2, '实际 ' + arc.count);
      ok('归档文本以归档标题开头', arc.text.indexOf('==== 归档于') === 0);
      const active = await Store.listActivities(SCH, false);
      ok('当前活动剩 2 个', active.length === 2, '实际 ' + active.length);
      ok('当前活动不含已归档', !active.some(a => a.name === '今早例会'));
      const hist = await Store.historyText(SCH);
      ok('历史含昨天全天招新', hist.includes('昨天全天招新'));
      ok('历史含今早例会', hist.includes('今早例会'));
      ok('历史含类型与地点', hist.includes('社团') && hist.includes('广场'));
      const todayActs = await Store.activitiesForDate(SCH, today, false);
      ok('今日当前活动仅今晚晚会', todayActs.length === 1 && todayActs[0].name === '今晚晚会', '实际 ' + todayActs.length);
      const updA = await Store.updateActivity(futureAct.id, { place: '大礼堂' });
      ok('更新活动地点', updA.place === '大礼堂');
      await Store.deleteActivity((await Store.listActivities(SCH, false)).find(a => a.name === '今晚晚会').id);
      ok('删除今晚晚会后当前活动 1 个', (await Store.listActivities(SCH, false)).length === 1);

      /* 7. 笔记 / 科目 / 搜索 */
      group('7. 笔记 / 科目聚合 / 搜索');
      await Store.putNote(SCH, { title: '数据结构', subject: '计算机', html: '<p>树与图</p>' });
      await new Promise(r => setTimeout(r, 5));   // 确保两篇 modified 时间戳不同，倒序结果确定
      const n2 = await Store.putNote(SCH, { title: '高数笔记', subject: '高等数学', html: '<p>极限</p>' });
      const subs = await Store.subjects(SCH);
      ok('科目含课程名“高等数学”', subs.includes('高等数学'));
      ok('科目含自定义“计算机”', subs.includes('计算机'));
      let notes = await Store.listNotes(SCH);
      ok('笔记共 2 篇', notes.length === 2);
      ok('按修改时间倒序（高数在前）', notes[0].title === '高数笔记');
      const ds = notes.find(n => n.title === '数据结构');
      const createdBefore = ds.created;
      await new Promise(r => setTimeout(r, 30));
      const dsUpd = await Store.putNote(SCH, { id: ds.id, title: '数据结构2', html: '<p>更新</p>' });
      ok('更新笔记标题', dsUpd.title === '数据结构2');
      ok('更新保留 created', dsUpd.created === createdBefore);
      ok('更新刷新 modified', dsUpd.modified >= dsUpd.created);
      ok('搜索命中标题', (await Store.searchNotes(SCH, '数据')).some(n => n.id === ds.id));
      ok('搜索命中正文', (await Store.searchNotes(SCH, '极限')).some(n => n.id === n2.id));
      ok('无结果搜索为空', (await Store.searchNotes(SCH, 'zzz不存在')).length === 0);

      /* 8. 考试成绩 */
      group('8. 考试成绩：考试 / 科目 CRUD、统计、趋势、固定格式导入、级联');
      const d1 = '2026-09-10', d2 = '2026-10-15', d3 = '2026-11-05';
      await throws('考试名空报错', () => Store.addExam(SCH, { name: '  ', date: d1 }), /不能为空/);
      await throws('考试日期非法报错', () => Store.addExam(SCH, { name: '坏日期', date: '2026-13-99' }), /日期/);
      const e1 = await Store.addExam(SCH, { name: '第一次月考', date: d1, type: '月考', term: '高一上', classRank: 8, gradeRank: 80, note: '开局' });
      const e2 = await Store.addExam(SCH, { name: '期中考试', date: d2, type: '期中', term: '高一上', classRank: 5, gradeRank: 42 });
      const e3 = await Store.addExam(SCH, { name: '期末考试', date: d3, type: '期末', term: '高一上' });
      ok('三场考试按日期升序', (await Store.listExams(SCH)).map(e => e.name).join(',') === '第一次月考,期中考试,期末考试');
      const tmpE = await Store.addExam(SCH, { name: '临时', date: '2026-08-01' });
      ok('类型缺省为月考', tmpE.type === '月考');
      await Store.deleteExam(tmpE.id);
      ok('删除临时考试', !(await Store.listExams(SCH)).some(e => e.name === '临时'));
      ok('最近考试=期末', (await Store.latestExam(SCH)).name === '期末考试');

      await Store.replaceExamScores(SCH, e1.id, [
        { subject: '语文', score: 118, maxScore: 150, classRank: 10, gradeRank: 60 },
        { subject: '数学', score: 132, maxScore: 150, classRank: 3, gradeRank: 20 },
        { subject: '英语', score: '', maxScore: 150 }
      ]);
      await throws('满分<=0 报错', () => Store.replaceExamScores(SCH, e2.id, [{ subject: '语文', score: 90, maxScore: 0 }]), /满分/);
      await throws('得分超满分报错', () => Store.replaceExamScores(SCH, e2.id, [{ subject: '语文', score: 160, maxScore: 150 }]), /须在/);
      await throws('科目重复报错', () => Store.replaceExamScores(SCH, e2.id, [{ subject: '语文', score: 90, maxScore: 100 }, { subject: '语文', score: 80, maxScore: 100 }]), /重复/);
      await throws('空科目报错', () => Store.replaceExamScores(SCH, e2.id, [{ subject: '  ', score: 90, maxScore: 100 }]), /科目名称不能为空/);
      await Store.replaceExamScores(SCH, e2.id, [
        { subject: '语文', score: 125, maxScore: 150, classRank: 6, gradeRank: 40 },
        { subject: '数学', score: 140, maxScore: 150, classRank: 1, gradeRank: 10 },
        { subject: '英语', score: 120, maxScore: 150, classRank: 8, gradeRank: 50 },
        { subject: '物理', score: 90, maxScore: 100, classRank: 2, gradeRank: 15 }
      ]);
      await Store.replaceExamScores(SCH, e3.id, [
        { subject: '语文', score: 130, maxScore: 150, classRank: 4, gradeRank: 30 },
        { subject: '数学', score: 145, maxScore: 150, classRank: 1, gradeRank: 5 }
      ]);

      const s1 = await Store.examSummary(SCH, e1.id);
      ok('e1 科目数 3（含未出分）', s1.count === 3, '实际 ' + s1.count);
      ok('e1 已出分 2 科', s1.scoredCount === 2);
      ok('e1 总分 250', s1.total === 250, '实际 ' + s1.total);
      ok('e1 总满分 300', s1.maxTotal === 300);
      ok('e1 总得分率 83.3', s1.rate === 83.3, '实际 ' + s1.rate);
      ok('e1 平均得分率 83.3', s1.avgRate === 83.3, '实际 ' + s1.avgRate);
      ok('e1 最高数学', s1.best.subject === '数学');
      ok('e1 最低语文', s1.worst.subject === '语文');
      const s2 = await Store.examSummary(SCH, e2.id);
      ok('e2 总分 475（满分不同）', s2.total === 475, '实际 ' + s2.total);
      ok('e2 总满分 550', s2.maxTotal === 550);
      ok('e2 总得分率 86.4', s2.rate === 86.4, '实际 ' + s2.rate);
      ok('e2 最高数学 93.3', s2.best.subject === '数学' && s2.best.rate === 93.3, JSON.stringify(s2.best));
      ok('e2 最低英语 80', s2.worst.subject === '英语' && s2.worst.rate === 80);
      await Store.replaceExamScores(SCH, e2.id, [
        { subject: '语文', score: 125, maxScore: 150 },
        { subject: '数学', score: 140, maxScore: 150 }
      ]);
      const s2b = await Store.examSummary(SCH, e2.id);
      ok('整场覆盖后 e2 仅 2 科', s2b.count === 2, '实际 ' + s2b.count);
      ok('整场覆盖后总满分 300', s2b.maxTotal === 300);
      await Store.replaceExamScores(SCH, e2.id, [
        { subject: '语文', score: 125, maxScore: 150, classRank: 6, gradeRank: 40 },
        { subject: '数学', score: 140, maxScore: 150, classRank: 1, gradeRank: 10 },
        { subject: '英语', score: 120, maxScore: 150, classRank: 8, gradeRank: 50 },
        { subject: '物理', score: 90, maxScore: 100, classRank: 2, gradeRank: 15 }
      ]);

      const ct = await Store.subjectTrend(SCH, '语文');
      ok('语文 3 次记录', ct.points.length === 3, '实际 ' + ct.points.length);
      ok('语文首次率 78.7', ct.points[0].rate === 78.7, '实际 ' + ct.points[0].rate);
      ok('语文最新=期末 86.7', ct.latest.rate === 86.7 && ct.latest.examName === '期末考试', '实际 ' + ct.latest.rate);
      ok('语文进退步 delta=3.4', ct.delta === 3.4, '实际 ' + ct.delta);
      ok('语文最高 86.7', ct.max.rate === 86.7);
      ok('语文最低 78.7', ct.min.rate === 78.7);
      ok('语文平均 82.9', ct.avg === 82.9, '实际 ' + ct.avg);
      const pt = await Store.subjectTrend(SCH, '物理');
      ok('物理 1 次记录', pt.count === 1);
      ok('单次 delta 为 null', pt.delta === null);
      const gSubs = await Store.scoreSubjects(SCH);
      ok('科目恰为 语文/数学/英语/物理', gSubs.length === 4 && ['语文', '数学', '英语', '物理'].every(x => gSubs.includes(x)), gSubs.join(','));

      let rt = await Store.rankTrend(SCH);
      ok('排名趋势 2 场（期末暂无排名）', rt.length === 2, '实际 ' + rt.length);
      ok('排名趋势首场班排 8、升序', rt[0].classRank === 8 && rt[0].examName === '第一次月考' && rt[1].examName === '期中考试');
      const e3upd = await Store.updateExam(e3.id, { classRank: 3, gradeRank: 20, note: '进步' });
      ok('更新期末班排为 3', e3upd.classRank === 3 && e3upd.note === '进步');
      ok('更新后排名趋势 3 场', (await Store.rankTrend(SCH)).length === 3);

      const tpl = Store.scoreTemplate();
      ok('固定格式模板标识与示例', tpl.format === Store.SCORE_FORMAT && Array.isArray(tpl.exams) && tpl.exams[0].scores.length === 3);
      const pid = Store.registerScoreProvider({ id: 'demo', name: '演示', async fetch() { return {}; }, parse(raw) { return raw; } });
      ok('注册 / 读取 Provider', pid === 'demo' && Store.getScoreProvider('demo') != null);
      ok('缺失 Provider 返回 null', Store.getScoreProvider('nope') === null);
      await throws('导入格式不符报错', () => Store.importScores(SCH, { format: 'wrong', exams: [] }), /格式不符/);
      await throws('导入空考试报错', () => Store.importScores(SCH, { format: Store.SCORE_FORMAT, exams: [] }), /没有任何考试/);
      const payload = {
        format: Store.SCORE_FORMAT, exams: [
          { name: '期中考试', date: d2, type: '期中', term: '高一上', classRank: 5, gradeRank: 42, scores: [
            { subject: '语文', score: 126, maxScore: 150 }, { subject: '数学', score: 140, maxScore: 150 },
            { subject: '英语', score: 120, maxScore: 150 }, { subject: '物理', score: 90, maxScore: 100 } ] },
          { name: '联考', date: '2026-12-20', type: '模拟考', term: '高一上', classRank: 2, gradeRank: 10, scores: [
            { subject: '语文', score: 140, maxScore: 150 }, { subject: '数学', score: 148, maxScore: 150 } ] }
        ]
      };
      const imp = await Store.importScores(SCH, payload);
      ok('导入计 2 场', imp.exams === 2, '实际 ' + imp.exams);
      ok('导入成绩 6 条', imp.scores === 6, '实际 ' + imp.scores);
      const examsAfter = await Store.listExams(SCH);
      ok('导入后共 4 场（期中幂等覆盖）', examsAfter.length === 4, '实际 ' + examsAfter.length);
      const mid = examsAfter.find(e => e.name === '期中考试');
      const midSum = await Store.examSummary(SCH, mid.id);
      ok('幂等覆盖：期中语文变 126', midSum.rows.find(r => r.subject === '语文').score === 126);
      ok('幂等覆盖：期中仍 4 科', midSum.count === 4, '实际 ' + midSum.count);
      ok('新增联考', examsAfter.some(e => e.name === '联考'));
      await Store.importScores(SCH, payload);
      ok('重复导入考试数不增长', (await Store.listExams(SCH)).length === 4);

      await Store.addSchool('成绩中学');
      const ce = await Store.addExam('成绩中学', { name: '校考', date: d1 });
      await Store.replaceExamScores('成绩中学', ce.id, [{ subject: '语文', score: 100, maxScore: 120 }]);
      await Store.deleteSchool('成绩中学');
      ok('删校级联删考试', (await Store.listExams('成绩中学')).length === 0);
      ok('删校级联删成绩', (await Store.listScores('成绩中学')).length === 0);

      /* 9. 图片 */
      group('9. 笔记图片：Blob 存取 / 显示替换 / 孤儿清理');
      const png = U.dataURLToBlob(PNG_DATAURL);
      ok('测试图片构造为 PNG', png.type === 'image/png' && png.size > 0, png.type + ' ' + png.size);
      const imgId = await Store.Images.put(SCH, png, { name: 'pic.png' });
      const rec = await Store.Images.getRecord(imgId);
      ok('图片记录 mime', rec.mime === 'image/png');
      const back = await Store.Images.getBlob(imgId);
      ok('读回 Blob 字节数一致', !!back && back.size === png.size);
      const withImg = await Store.putNote(SCH, { title: '带图笔记', subject: '计算机', html: '<p>图：<img src="' + U.assetRef(imgId) + '"></p>' });
      const res = await Store.Images.resolveHtml(withImg.html);
      ok('显示时替换为 blob: URL', res.html.indexOf('blob:') >= 0 && res.html.indexOf('asset:') < 0);
      ok('生成 1 个临时 URL', res.urls.length === 1);
      Store.Images.revokeUrls(res.urls);
      let orphans = await Store.Images.cleanupOrphans(SCH);
      ok('被引用图片不算孤儿（删 0）', orphans === 0, '实际 ' + orphans);
      await Store.deleteNote(withImg.id);
      orphans = await Store.Images.cleanupOrphans(SCH);
      ok('删笔记后清理孤儿图片（删 1）', orphans === 1, '实际 ' + orphans);
      ok('孤儿图片已不可读', (await Store.Images.getBlob(imgId)) === null);

      /* 10. 备份 / 导入 / 持久化 */
      group('10. 备份导出 / 导入 / 重启持久化');
      const img2 = await Store.Images.put(SCH, png, {});
      const keep = await Store.putNote(SCH, { title: '留存图笔记', subject: '计算机', html: '<img src="' + U.assetRef(img2) + '">' });
      const json = await Store.exportData();
      const parsed = JSON.parse(json);
      ok('导出文件带应用标识', parsed.app === 'CampusPlatform' && parsed.format === 1);
      ok('导出含 1 张图片', parsed.data.assets.length === 1, '实际 ' + parsed.data.assets.length);
      ok('图片以 base64 dataURL 内联', typeof parsed.data.assets[0].dataURL === 'string' && parsed.data.assets[0].dataURL.indexOf('data:image/png;base64,') === 0);
      ok('导出含 3 篇笔记', parsed.data.notes.length === 3, '实际 ' + parsed.data.notes.length);
      ok('导出含 4 场考试', parsed.data.exams.length === 4, '实际 ' + parsed.data.exams.length);
      ok('导出含 11 条成绩', parsed.data.scores.length === 11, '实际 ' + parsed.data.scores.length);
      await AppDB.close();
      await AppDB.open();
      ok('重开（模拟重启）后学校仍在', (await Store.listSchools()).length === 1);
      ok('重开后笔记仍在', (await Store.listNotes(SCH)).length === 3);
      await Store.resetAll();
      ok('重置后笔记为空', (await Store.listNotes(SCH)).length === 0);
      const summary = await Store.importData(json);
      ok('导入恢复学校 1', summary.schools === 1, JSON.stringify(summary));
      ok('导入恢复课程 2', summary.courses === 2, '实际 ' + summary.courses);
      ok('导入恢复日程 2', summary.schedules === 2, '实际 ' + summary.schedules);
      ok('导入恢复活动 3', summary.activities === 3, '实际 ' + summary.activities);
      ok('导入恢复笔记 3', summary.notes === 3, '实际 ' + summary.notes);
      ok('导入恢复图片 1', summary.assets === 1, '实际 ' + summary.assets);
      ok('导入恢复考试 4', summary.exams === 4, '实际 ' + summary.exams);
      ok('导入恢复成绩 11', summary.scores === 11, '实际 ' + summary.scores);
      const b2 = await Store.Images.getBlob(img2);
      ok('导入后图片字节一致', !!b2 && b2.size === png.size);
      const keepNote = (await Store.listNotes(SCH)).find(n => n.id === keep.id);
      const res2 = await Store.Images.resolveHtml(keepNote.html);
      ok('导入后图片仍可解析显示', res2.html.indexOf('blob:') >= 0);
      Store.Images.revokeUrls(res2.urls);
      ok('导入后当前学校有效', (await Store.currentSchool()) === SCH);
    } catch (e) {
      fail++;
      line('自检中断：' + (e.stack || e.message), 'bad');
    }

    line('', '');
    line('结果：' + pass + ' 通过 / ' + fail + ' 失败', fail === 0 ? 'ok' : 'bad');
    sumEl.textContent = fail === 0
      ? '全部通过：' + pass + ' 项断言通过，0 失败'
      : '存在失败：' + pass + ' 通过，' + fail + ' 失败';
    sumEl.className = fail === 0 ? 'pass' : 'fail';
    document.body.dataset.result = fail === 0 ? 'pass' : 'fail';
    document.title = fail === 0 ? 'PASS' : 'FAIL';
  }

  document.getElementById('btnRun').addEventListener('click', runAll);
  document.getElementById('btnExport').addEventListener('click', async function () {
    try { await Store.downloadBackup(); line('已触发备份下载', 'g'); }
    catch (e) { line('导出失败：' + e.message, 'bad'); }
  });
  const importFile = document.getElementById('importFile');
  document.getElementById('btnImport').addEventListener('click', function () { importFile.click(); });
  importFile.addEventListener('change', async function (e) {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const txt = await f.text();
      const s = await Store.importData(txt);
      line('导入完成：' + JSON.stringify(s), 'g');
    } catch (err) {
      line('导入失败：' + err.message, 'bad');
    }
    e.target.value = '';
  });
  document.getElementById('btnReset').addEventListener('click', async function () {
    await Store.resetAll();
    line('已重置为初始空数据（默认“我的学校”）', 'g');
  });

  runAll();
})();
