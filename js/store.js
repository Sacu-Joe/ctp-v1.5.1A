/* ============================================================
 * store.js — 数据访问层（所有方法均为 async，基于 Dexie/IndexedDB）
 *
 * 五个模块的界面后续只调用 window.Store 上的方法，不直接碰数据库。
 * 字段与业务口径与桌面版（C++/Qt AppData）保持一致。
 * ============================================================ */
(function (global) {
  'use strict';

  const db = global.AppDB;
  const M = global.AppDBMeta;

  function toInt(v, def) {
    const n = parseInt(v, 10);
    return isNaN(n) ? def : n;
  }
  function cmpLocale(a, b) { return String(a).localeCompare(String(b), 'zh'); }
  function nowISO() { return new Date().toISOString(); }

  function normalizeCourse(x) {
    const weekType = ['all', 'odd', 'even'].indexOf(x.weekType) >= 0 ? x.weekType : 'all';
    return {
      id: x.id,
      school: x.school,
      name: String(x.name || ''),
      place: String(x.place || ''),
      teacher: String(x.teacher || ''),
      day: toInt(x.day, 1),
      startPeriod: toInt(x.startPeriod, 1),
      endPeriod: toInt(x.endPeriod, 1),
      startWeek: toInt(x.startWeek, 1),
      endWeek: toInt(x.endWeek, 16),
      weekType: weekType
    };
  }

  function normalizeActivity(x) {
    return {
      id: x.id,
      school: x.school,
      name: String(x.name || ''),
      date: String(x.date || ''),
      start: String(x.start || ''),
      end: String(x.end || ''),
      place: String(x.place || ''),
      organizer: String(x.organizer || ''),
      type: String(x.type || '其他'),
      note: String(x.note || ''),
      archived: x.archived ? 1 : 0,
      archivedAt: x.archivedAt || null
    };
  }

  // 排名：空 / 非正整数 -> null（允许留空）
  function toRank(v) {
    if (v === '' || v == null) return null;
    const n = parseInt(v, 10);
    return (isNaN(n) || n <= 0) ? null : n;
  }
  // 得分：空 -> null（该科暂未出分），否则数值
  function toScore(v) {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  }

  function normalizeExam(x) {
    return {
      id: x.id,
      school: x.school,
      name: String(x.name || '').trim(),
      date: String(x.date || ''),
      type: U.EXAM_TYPES.indexOf(x.type) >= 0 ? x.type : '月考',
      term: String(x.term || '').trim(),
      classRank: toRank(x.classRank),
      gradeRank: toRank(x.gradeRank),
      note: String(x.note || ''),
      createdAt: x.createdAt || nowISO()
    };
  }

  function normalizeScore(school, examId, x) {
    const max = toScore(x.maxScore);
    return {
      id: x.id || U.uuid(),
      school: school,
      examId: examId,
      subject: String(x.subject || '').trim(),
      score: toScore(x.score),
      // 仅在缺省（空）时默认满分 100；显式传入 <=0 保留原值，交由 replace/import 校验抛错
      maxScore: max == null ? 100 : max,
      classRank: toRank(x.classRank),
      gradeRank: toRank(x.gradeRank)
    };
  }

  const Store = {

    /* ================= 初始化 / 首启种子 ================= */
    async init() {
      await db.open();
      await db.transaction('rw', db.kv, db.schools, async () => {
        let schools = await db.schools.toArray();
        let curRow = await db.kv.get('currentSchool');
        let cur = curRow ? curRow.value : null;

        if (schools.length === 0) {
          const name = '我的学校';
          await db.schools.put(Store.freshSchool(name));
          cur = name;
        } else {
          const names = schools.map(s => s.name).sort(cmpLocale);
          if (names.indexOf(cur) === -1) cur = names[0];
        }
        await db.kv.put({ key: 'currentSchool', value: cur });
        if (!(await db.kv.get('scheduleRemind'))) {
          await db.kv.put({ key: 'scheduleRemind', value: true });
        }
      });
      return await Store.currentSchool();
    },

    // 一所新学校的默认课表配置（开学日=本周一，20 周，每天 10 节，方案一钟点）
    freshSchool(name) {
      return {
        name: name,
        totalWeeks: 20,
        periodsPerDay: 10,
        firstDate: U.dateStr(U.mondayOfWeek(new Date())),
        bells: U.defaultBells(),
        createdAt: nowISO()
      };
    },

    /* ================= 全局设置 kv ================= */
    async getSetting(key, def) {
      const row = await db.kv.get(key);
      return typeof row === 'undefined' ? def : row.value;
    },
    async setSetting(key, value) {
      await db.kv.put({ key: key, value: value });
      return value;
    },
    async currentSchool() { return await Store.getSetting('currentSchool', '我的学校'); },
    async setCurrentSchool(name) { return await Store.setSetting('currentSchool', name); },
    async scheduleRemindEnabled() { return await Store.getSetting('scheduleRemind', true); },
    async setScheduleRemindEnabled(on) { return await Store.setSetting('scheduleRemind', !!on); },

    /* ================= 学校 ================= */
    async listSchools() {
      const rows = await db.schools.toArray();
      return rows.sort((a, b) => cmpLocale(a.name, b.name));
    },
    async getSchool(name) {
      return await db.schools.get(name);
    },
    async currentSchoolRecord() {
      return await db.schools.get(await Store.currentSchool());
    },
    async addSchool(rawName) {
      const name = U.sanitizeSchoolName(rawName);
      if (!name) throw new Error('学校名称不能为空');
      if (await db.schools.get(name)) throw new Error('该学校已存在，请在列表中直接选择');
      await db.schools.put(Store.freshSchool(name));
      await Store.setCurrentSchool(name);
      return name;
    },
    async deleteSchool(name) {
      const all = await Store.listSchools();
      if (all.length <= 1) throw new Error('至少需要保留一所学校');
      if (!all.some(s => s.name === name)) throw new Error('学校不存在');
      await db.transaction('rw', db.schools, db.courses, db.activities, db.exams, db.scores,
        db.notes, db.assets, async () => {
        await db.schools.delete(name);
        await db.courses.where('school').equals(name).delete();
        await db.activities.where('school').equals(name).delete();
        await db.exams.where('school').equals(name).delete();
        await db.scores.where('school').equals(name).delete();
        await db.notes.where('school').equals(name).delete();
        await db.assets.where('school').equals(name).delete();
      });
      if ((await Store.currentSchool()) === name) {
        const rest = await Store.listSchools();
        if (rest.length) await Store.setCurrentSchool(rest[0].name);
      }
    },
    // 保存课表设置（总周数 / 每天节数 / 开学日 / 钟点），自动校正钟点条数
    async saveTimetableSettings(name, patch) {
      const s = await db.schools.get(name);
      if (!s) throw new Error('学校不存在');
      if (patch.totalWeeks !== undefined) s.totalWeeks = toInt(patch.totalWeeks, s.totalWeeks);
      if (patch.periodsPerDay !== undefined) s.periodsPerDay = toInt(patch.periodsPerDay, s.periodsPerDay);
      if (patch.firstDate !== undefined) s.firstDate = patch.firstDate;
      if (patch.bells !== undefined) s.bells = patch.bells;
      s.bells = U.ensureBells(s.bells, s.periodsPerDay);
      await db.schools.put(s);
      return s;
    },

    /* ================= 课程 ================= */
    async listCourses(school) {
      return await db.courses.where('school').equals(school).toArray();
    },
    async addCourse(school, data) {
      const rec = normalizeCourse(Object.assign({
        id: U.uuid(), school: school
      }, data));
      await db.courses.put(rec);
      return rec;
    },
    async updateCourse(id, patch) {
      const old = await db.courses.get(id);
      if (!old) throw new Error('课程不存在');
      const rec = normalizeCourse(Object.assign({}, old, patch, { id: id }));
      await db.courses.put(rec);
      return rec;
    },
    async deleteCourse(id) { await db.courses.delete(id); },

    async coursesForDate(school, date) {
      const s = await db.schools.get(school);
      const cs = await Store.listCourses(school);
      return U.coursesForDate(cs, s, date instanceof Date ? date : U.parseDate(date));
    },
    async upcomingCoursesToday(school, limit, now) {
      const s = await db.schools.get(school);
      const cs = await Store.listCourses(school);
      return U.upcomingCoursesToday(cs, s, limit || 5, now || new Date());
    },
    async bellOf(school, period) {
      const s = await db.schools.get(school);
      return U.bellOf(s ? s.bells : [], period);
    },

    /* ================= 日程（全局，不跟随学校） ================= */
    async listSchedules() { return await db.schedules.toArray(); },
    async listByDate(dateStr) {
      const rows = await db.schedules.where('date').equals(dateStr).toArray();
      return U.sortActivities(rows); // 同样按开始时间排序，全天在后
    },
    async addSchedule(data) {
      const rec = Object.assign({
        id: U.uuid(), title: '', date: U.todayStr(), start: '', end: '',
        note: '', done: false, reminded: false
      }, data);
      await db.schedules.put(rec);
      return rec;
    },
    async updateSchedule(id, patch) {
      const old = await db.schedules.get(id);
      if (!old) throw new Error('日程不存在');
      const rec = Object.assign({}, old, patch, { id: id });
      await db.schedules.put(rec);
      return rec;
    },
    async deleteSchedule(id) { await db.schedules.delete(id); },
    async setScheduleDone(id, done) { return await Store.updateSchedule(id, { done: !!done }); },
    async markScheduleReminded(id) { return await Store.updateSchedule(id, { reminded: true }); },
    // 未完成、未提醒、当前已到开始时间的日程（供定时器做弹窗）
    async dueSchedules(now) {
      now = now || new Date();
      const today = U.dateStr(now);
      const nowSec = now.getHours() * 3600 + now.getMinutes() * 60;
      const rows = await Store.listByDate(today);
      return rows.filter(r => {
        if (r.done || r.reminded) return false;
        const t = U.timeToSec(r.start);
        return t !== null && t <= nowSec;
      });
    },

    /* ================= 活动 ================= */
    async listActivities(school, includeArchived) {
      let rows = await db.activities.where('school').equals(school).toArray();
      if (!includeArchived) rows = rows.filter(a => !a.archived);
      return rows;
    },
    async addActivity(school, data) {
      const rec = normalizeActivity(Object.assign({ id: U.uuid(), school: school }, data));
      await db.activities.put(rec);
      return rec;
    },
    async updateActivity(id, patch) {
      const old = await db.activities.get(id);
      if (!old) throw new Error('活动不存在');
      const rec = normalizeActivity(Object.assign({}, old, patch, { id: id }));
      await db.activities.put(rec);
      return rec;
    },
    async deleteActivity(id) { await db.activities.delete(id); },

    async activitiesForDate(school, dateStr, includeArchived) {
      const rows = await Store.listActivities(school, includeArchived);
      return U.sortActivities(rows.filter(a => a.date === dateStr));
    },

    // 生成单个活动的归档文本块（复刻桌面“活动历史.txt”格式）
    historyBlock(a) {
      const hasTime = U.timeToSec(a.start) !== null || U.timeToSec(a.end) !== null;
      let tm = '';
      if (hasTime) {
        const s = U.timeToSec(a.start) !== null ? a.start : '--:--';
        const e = U.timeToSec(a.end) !== null ? a.end : '--:--';
        tm = s + ' - ' + e;
      }
      return '==== 归档于 ' + (a.archivedAt || '') + ' ====\n' +
        '活动名称：' + (a.name || '') + '\n' +
        '日期：' + (a.date || '') + '\n' +
        '时间：' + tm + '\n' +
        '地点：' + (a.place || '') + '\n' +
        '主办方：' + (a.organizer || '') + '\n' +
        '类型：' + (a.type || '') + '\n' +
        '备注：' + (a.note || '') + '\n\n';
    },

    // 把已结束活动置为归档（archived=1），返回本次归档数量与文本块
    async archivePast(school, now) {
      now = now || new Date();
      const all = await db.activities.where('school').equals(school).toArray();
      const moved = [];
      for (const a of all) {
        if (a.archived) continue;
        const end = U.activityEnd(a, now);
        if (end && end.getTime() < now.getTime()) {
          a.archived = 1;
          a.archivedAt = U.nowDateTime(now);
          moved.push(a);
        }
      }
      if (moved.length) {
        await db.transaction('rw', db.activities, async () => {
          for (const a of moved) await db.activities.put(a);
        });
      }
      return {
        count: moved.length,
        moved: moved,
        text: moved.map(a => Store.historyBlock(a)).join('')
      };
    },

    // 某学校的完整历史文本（按归档先后），等价于桌面的“活动历史.txt”
    async historyText(school) {
      const rows = await db.activities.where('school').equals(school).toArray();
      return rows
        .filter(a => a.archived)
        .sort((a, b) => String(a.archivedAt).localeCompare(String(b.archivedAt)))
        .map(a => Store.historyBlock(a))
        .join('');
    },
    async exportHistoryTxt(school, filename) {
      const text = await Store.historyText(school);
      U.downloadText(filename || '活动历史.txt', text, 'text/plain;charset=utf-8');
      return text;
    },

    /* ================= 考试成绩（考试 × 科目，数据按学校保存） ================= */
    // 考试按日期升序返回（趋势按时间从早到晚；界面要“最新在前”自行反转）
    async listExams(school) {
      const rows = await db.exams.where('school').equals(school).toArray();
      return rows.sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return cmpLocale(a.name, b.name);
      });
    },
    async getExam(id) { return await db.exams.get(id); },
    async addExam(school, data) {
      const rec = normalizeExam(Object.assign({ id: U.uuid(), school: school }, data));
      if (!rec.name) throw new Error('考试名称不能为空');
      if (!U.parseDate(rec.date)) throw new Error('考试日期不合法');
      await db.exams.put(rec);
      return rec;
    },
    async updateExam(id, patch) {
      const old = await db.exams.get(id);
      if (!old) throw new Error('考试不存在');
      const rec = normalizeExam(Object.assign({}, old, patch, { id: id }));
      if (!rec.name) throw new Error('考试名称不能为空');
      if (!U.parseDate(rec.date)) throw new Error('考试日期不合法');
      await db.exams.put(rec);
      return rec;
    },
    async deleteExam(id) {
      const ex = await db.exams.get(id);
      if (!ex) return;
      await db.transaction('rw', db.exams, db.scores, async () => {
        await db.scores.where('examId').equals(id).delete();
        await db.exams.delete(id);
      });
    },
    async listScores(school) {
      return await db.scores.where('school').equals(school).toArray();
    },
    async listScoresForExam(school, examId) {
      const rows = await db.scores.where('[school+examId]').equals([school, examId]).toArray();
      return rows.sort(function (a, b) { return cmpLocale(a.subject, b.subject); });
    },
    // 整场覆盖保存某场考试的全部单科成绩（录入表格一次提交）；rows 为裸字段数组
    async replaceExamScores(school, examId, rows) {
      const ex = await db.exams.get(examId);
      if (!ex || ex.school !== school) throw new Error('考试不存在');
      const norm = [];
      const seen = {};
      for (const r of (rows || [])) {
        const s = normalizeScore(school, examId, r);
        if (!s.subject) throw new Error('科目名称不能为空');
        if (!(s.maxScore > 0)) throw new Error('「' + s.subject + '」满分必须大于 0');
        if (s.score != null && (s.score < 0 || s.score > s.maxScore))
          throw new Error('「' + s.subject + '」得分须在 0 与满分 ' + s.maxScore + ' 之间');
        const key = s.subject.toLowerCase();
        if (seen[key]) throw new Error('科目「' + s.subject + '」重复，请合并');
        seen[key] = 1;
        norm.push(s);
      }
      await db.transaction('rw', db.scores, async () => {
        await db.scores.where('examId').equals(examId).delete();
        if (norm.length) await db.scores.bulkPut(norm);
      });
      return norm;
    },
    async deleteScore(id) { await db.scores.delete(id); },
    // 有成绩记录的全部科目（去重、本地化排序）
    async scoreSubjects(school) {
      const rows = await Store.listScores(school);
      const set = new Set();
      rows.forEach(function (r) { const s = (r.subject || '').trim(); if (s) set.add(s); });
      return Array.from(set).sort(cmpLocale);
    },
    // 单次考试汇总：总分 / 总满分 / 总得分率 / 平均得分率 / 最高最低科目
    async examSummary(school, examId) {
      const ex = await db.exams.get(examId);
      const rows = await Store.listScoresForExam(school, examId);
      let total = 0, maxTotal = 0, rateSum = 0, rated = 0, best = null, worst = null;
      rows.forEach(function (r) {
        if (r.score != null && r.maxScore > 0) {
          total += r.score; maxTotal += r.maxScore;
          const rate = r.score / r.maxScore * 100; rateSum += rate; rated++;
          const rate1 = Math.round(rate * 10) / 10;
          if (!best || rate > best.rate) best = { subject: r.subject, score: r.score, max: r.maxScore, rate: rate1 };
          if (!worst || rate < worst.rate) worst = { subject: r.subject, score: r.score, max: r.maxScore, rate: rate1 };
        }
      });
      return {
        exam: ex, rows: rows, count: rows.length, scoredCount: rated,
        total: Math.round(total * 100) / 100, maxTotal: maxTotal,
        rate: maxTotal > 0 ? Math.round(total / maxTotal * 1000) / 10 : null,
        avgRate: rated ? Math.round(rateSum / rated * 10) / 10 : null,
        best: best, worst: worst
      };
    },
    // 某科历次成绩趋势（按考试日期升序），含平均 / 最高 / 最低 / 相比上次得分率差
    async subjectTrend(school, subject) {
      const exams = await Store.listExams(school);
      const points = [];
      for (const ex of exams) {
        const rows = await Store.listScoresForExam(school, ex.id);
        const r = rows.find(function (x) { return x.subject.trim() === String(subject).trim(); });
        if (r) points.push({
          examId: ex.id, examName: ex.name, date: ex.date, type: ex.type,
          score: r.score, max: r.maxScore,
          rate: (r.score != null && r.maxScore > 0) ? Math.round(r.score / r.maxScore * 1000) / 10 : null,
          classRank: r.classRank, gradeRank: r.gradeRank
        });
      }
      const rated = points.filter(function (p) { return p.rate != null; });
      let avg = null, min = null, max = null, delta = null;
      if (rated.length) {
        avg = Math.round(rated.reduce(function (a, p) { return a + p.rate; }, 0) / rated.length * 10) / 10;
        min = rated.reduce(function (a, p) { return p.rate < a.rate ? p : a; }, rated[0]);
        max = rated.reduce(function (a, p) { return p.rate > a.rate ? p : a; }, rated[0]);
        if (rated.length >= 2) delta = Math.round((rated[rated.length - 1].rate - rated[rated.length - 2].rate) * 10) / 10;
      }
      return {
        subject: subject, points: points, count: points.length, avg: avg,
        min: min, max: max, delta: delta, latest: rated.length ? rated[rated.length - 1] : null
      };
    },
    // 总分排名趋势（历次考试班排 / 年排，按日期升序；至少填了一个排名的考试）
    async rankTrend(school) {
      const exams = await Store.listExams(school);
      return exams
        .filter(function (e) { return e.classRank != null || e.gradeRank != null; })
        .map(function (e) {
          return { examId: e.id, examName: e.name, date: e.date, classRank: e.classRank, gradeRank: e.gradeRank };
        });
    },
    // 最近一次考试（日期最新），无则 null（首页简卡用）
    async latestExam(school) {
      const exams = await Store.listExams(school);
      return exams.length ? exams[exams.length - 1] : null;
    },

    /* ---- 教务网站成绩导入：固定格式 + 数据源适配器（本版仅预留接口，界面不暴露入口） ----
     * 固定格式（JSON，UTF-8）：
     * { "format":"campus-platform.scores.v1", "school":"我的学校",   // school 可省略
     *   "exams":[ { "name":"高一上期中","date":"2026-11-05","type":"期中","term":"高一上",
     *               "classRank":5,"gradeRank":42,"note":"",
     *               "scores":[ {"subject":"语文","score":118,"maxScore":150,"classRank":3,"gradeRank":30} ] } ] }
     * 对接某教务网站时，新增一个 Provider：
     *   { id:'jiaowu-xxx', name:'某校教务',
     *     async fetch(params){ /* 登录/抓取，返回原始数据（自动登录、验证码、跨域通常需后端代理）*\/ },
     *     parse(raw){ /* 把原始数据映射为上面的固定格式对象并返回 *\/ } }
     * 注册后调用：Store.importScores(school, provider.parse(await provider.fetch(params)))。
     * 手动录入界面直接走 addExam / replaceExamScores，不经过 Provider。
     */
    SCORE_FORMAT: 'campus-platform.scores.v1',
    _scoreProviders: {},
    registerScoreProvider(p) { if (p && p.id) { Store._scoreProviders[p.id] = p; return p.id; } return null; },
    getScoreProvider(id) { return Store._scoreProviders[id] || null; },
    // 一份固定格式模板（字段齐全，含示例），供将来导出模板 / 文档对照
    scoreTemplate() {
      return {
        format: Store.SCORE_FORMAT, school: '',
        exams: [{
          name: '示例：高一上期中考试', date: U.todayStr(), type: '期中', term: '高一上',
          classRank: null, gradeRank: null, note: '',
          scores: [
            { subject: '语文', score: 118, maxScore: 150, classRank: null, gradeRank: null },
            { subject: '数学', score: 132, maxScore: 150, classRank: null, gradeRank: null },
            { subject: '英语', score: 125, maxScore: 150, classRank: null, gradeRank: null }
          ]
        }]
      };
    },
    // 按固定格式导入；幂等：同校 + 同名 + 同日期视为同一场，覆盖更新（含其全部单科成绩）
    async importScores(school, payload) {
      if (!payload || payload.format !== Store.SCORE_FORMAT)
        throw new Error('成绩数据格式不符（应为 ' + Store.SCORE_FORMAT + '）');
      const examsIn = Array.isArray(payload.exams) ? payload.exams : [];
      if (!examsIn.length) throw new Error('数据中没有任何考试成绩');
      let examCount = 0, scoreCount = 0;
      await db.transaction('rw', db.exams, db.scores, async () => {
        for (const e0 of examsIn) {
          const name = String(e0.name || '').trim();
          const date = String(e0.date || '');
          if (!name) throw new Error('存在没有名称的考试');
          if (!U.parseDate(date)) throw new Error('考试「' + name + '」日期不合法：' + date);
          const same = await db.exams.where('[school+date]').equals([school, date]).toArray();
          const existed = same.find(function (x) { return x.name === name; });
          const ex = existed
            ? normalizeExam(Object.assign({}, existed, e0, { id: existed.id, school: school }))
            : normalizeExam(Object.assign({ id: U.uuid(), school: school }, e0));
          await db.exams.put(ex);
          await db.scores.where('examId').equals(ex.id).delete();
          const seen = {};
          for (const r0 of (Array.isArray(e0.scores) ? e0.scores : [])) {
            const s = normalizeScore(school, ex.id, r0);
            if (!s.subject) throw new Error('考试「' + name + '」存在没有科目的成绩');
            if (!(s.maxScore > 0)) throw new Error('「' + name + ' / ' + s.subject + '」满分必须大于 0');
            if (s.score != null && (s.score < 0 || s.score > s.maxScore))
              throw new Error('「' + name + ' / ' + s.subject + '」得分须在 0 与满分之间');
            const key = s.subject.toLowerCase();
            if (seen[key]) throw new Error('考试「' + name + '」科目「' + s.subject + '」重复');
            seen[key] = 1;
            await db.scores.put(s); scoreCount++;
          }
          examCount++;
        }
      });
      return { exams: examCount, scores: scoreCount };
    },

    /* ================= 课堂笔记 ================= */
    async listNotes(school) {
      const rows = await db.notes.where('school').equals(school).toArray();
      return rows.sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
    },
    async getNote(id) { return await db.notes.get(id); },
    async putNote(school, data) {
      const ts = nowISO();
      let rec;
      if (data.id) {
        const old = await db.notes.get(data.id);
        if (!old) throw new Error('笔记不存在');
        rec = Object.assign({}, old, data, { school: school, id: old.id, modified: ts });
      } else {
        rec = {
          id: U.uuid(),
          school: school,
          title: String(data.title || '无标题'),
          subject: String(data.subject || ''),
          html: String(data.html || ''),
          created: ts,
          modified: ts
        };
      }
      rec.html = U.sanitizeHtml(rec.html || '');   // 入库前净化，避免正文携带脚本
      await db.notes.put(rec);
      return rec;
    },
    async deleteNote(id) { await db.notes.delete(id); },
    async searchNotes(school, kw) {
      const q = String(kw || '').trim().toLowerCase();
      const rows = await Store.listNotes(school);
      if (!q) return rows;
      const plain = h => String(h || '').replace(/<[^>]*>/g, ' ').toLowerCase();
      return rows.filter(n =>
        String(n.title).toLowerCase().indexOf(q) >= 0 ||
        String(n.subject).toLowerCase().indexOf(q) >= 0 ||
        plain(n.html).indexOf(q) >= 0);
    },
    // 科目 = 课程名 + 笔记中出现过的自定义科目，去重并按本地化排序
    async subjects(school) {
      const set = new Set();
      (await Store.listCourses(school)).forEach(c => {
        const n = (c.name || '').trim();
        if (n) set.add(n);
      });
      (await Store.listNotes(school)).forEach(n => {
        const s = (n.subject || '').trim();
        if (s) set.add(s);
      });
      return Array.from(set).sort(cmpLocale);
    },
    // 从 PDF 导入的 payload 重建该学校笔记（覆盖式，保留原始 id，保证导入导出完全一致）
    async importNotesPayload(school, payload) {
      const notes = Array.isArray(payload.notes) ? payload.notes : [];
      const assets = Array.isArray(payload.assets) ? payload.assets : [];
      await db.transaction('rw', db.notes, db.assets, async () => {
        await db.notes.where('school').equals(school).delete();
        await db.assets.where('school').equals(school).delete();
        for (const a of assets) {
          const blob = a.dataURL ? U.dataURLToBlob(a.dataURL) : new Blob([]);
          await db.assets.put({
            id: a.id, school: school, mime: a.mime || 'image/png', blob: blob,
            name: a.name || '', createdAt: a.createdAt || nowISO()
          });
        }
        for (const n of notes) {
          await db.notes.put({
            id: n.id, school: school, title: String(n.title || ''), subject: String(n.subject || ''),
            html: U.sanitizeHtml(n.html || ''), created: n.created || nowISO(), modified: n.modified || nowISO()
          });
        }
      });
      return { notes: notes.length, assets: assets.length };
    },

    /* ================= 笔记图片（二进制 Blob 直接存 IndexedDB） ================= */
    Images: {
      // 存入一张图片（File 或 Blob），返回资源 id；正文里用 src="asset:<id>" 引用
      async put(school, blobOrFile, meta) {
        const id = U.uuid();
        const blob = blobOrFile;
        const rec = {
          id: id,
          school: school,
          mime: (blob && blob.type) || 'image/png',
          blob: blob,
          name: (meta && meta.name) || '',
          createdAt: nowISO()
        };
        await db.assets.put(rec);
        return id;
      },
      async getRecord(id) { return await db.assets.get(id); },
      async getBlob(id) {
        const r = await db.assets.get(id);
        return r ? r.blob : null;
      },
      // 把正文里的 asset:<id> 替换成临时 blob: URL 用于显示；返回 urls 供用完后 revoke
      async resolveHtml(html) {
        const ids = U.extractAssetIds(html);
        const urlMap = {};
        const urls = [];
        for (const id of ids) {
          const blob = await Store.Images.getBlob(id);
          if (blob) {
            const u = URL.createObjectURL(blob);
            urlMap[id] = u;
            urls.push(u);
          }
        }
        return { html: U.replaceAssetRefs(html, urlMap), urls: urls };
      },
      revokeUrls(urls) {
        (urls || []).forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
      },
      // 删除该学校中未被任何笔记引用的孤儿图片，返回删除数量
      async cleanupOrphans(school) {
        const notes = await Store.listNotes(school);
        const used = new Set();
        notes.forEach(n => U.extractAssetIds(n.html).forEach(i => used.add(i)));
        const imgs = await db.assets.where('school').equals(school).toArray();
        let removed = 0;
        for (const im of imgs) {
          if (!used.has(im.id)) { await db.assets.delete(im.id); removed++; }
        }
        return removed;
      }
    },

    /* ================= 备份：导出 / 导入 / 重置 ================= */
    // 导出整个库为 JSON 字符串（图片转 dataURL/base64 内联）
    async exportData() {
      const data = {};
      for (const t of M.TABLES) {
        const rows = await db[t].toArray();
        if (t === 'assets') {
          data[t] = [];
          for (const r of rows) {
            const dataURL = r.blob ? await U.blobToDataURL(r.blob) : null;
            data[t].push({
              id: r.id, school: r.school, mime: r.mime, name: r.name,
              createdAt: r.createdAt, dataURL: dataURL
            });
          }
        } else {
          data[t] = rows;
        }
      }
      return JSON.stringify({
        app: M.APP_TAG,
        format: M.FORMAT,
        exportedAt: new Date().toISOString(),
        data: data
      }, null, 2);
    },
    async downloadBackup(filename) {
      const json = await Store.exportData();
      U.downloadText(filename || ('校园任务平台备份-' + U.todayStr() + '.json'), json,
        'application/json;charset=utf-8');
      return json;
    },
    // 从 JSON 文本恢复；默认整库替换
    async importData(jsonText) {
      let obj;
      try { obj = JSON.parse(jsonText); } catch (e) { throw new Error('备份文件不是合法的 JSON'); }
      if (!obj || obj.app !== M.APP_TAG || !obj.data) throw new Error('不是有效的校园任务平台备份文件');
      const d = obj.data;
      const tables = M.TABLES.map(t => db[t]);
      await db.transaction('rw', ...tables, async () => {
        for (const t of M.TABLES) { await db[t].clear(); }
        for (const t of M.TABLES) {
          let rows = Array.isArray(d[t]) ? d[t] : [];
          if (t === 'assets') {
            rows = rows.map(r => {
              const copy = Object.assign({}, r);
              delete copy.dataURL;
              copy.blob = r.dataURL ? U.dataURLToBlob(r.dataURL) : new Blob([]);
              return copy;
            });
          }
          if (t === 'notes') {
            // 备份可能来自别处：入库前净化正文，防止携带脚本
            rows = rows.map(r => {
              const copy = Object.assign({}, r);
              copy.html = U.sanitizeHtml(copy.html || '');
              return copy;
            });
          }
          if (rows.length) await db[t].bulkPut(rows);
        }
      });
      // 校正当前学校指向
      const schools = await Store.listSchools();
      if (schools.length) {
        const names = schools.map(s => s.name);
        let cur = await Store.getSetting('currentSchool', null);
        if (names.indexOf(cur) === -1) await Store.setCurrentSchool(names.sort(cmpLocale)[0]);
      }
      const summary = {};
      for (const t of M.TABLES) summary[t] = await db[t].count();
      return summary;
    },
    // 清空全部数据并重新播种首启默认学校
    async resetAll() {
      const tables = M.TABLES.map(t => db[t]);
      await db.transaction('rw', ...tables, async () => {
        for (const t of M.TABLES) await db[t].clear();
      });
      return await Store.init();
    }
  };

  global.Store = Store;
})(window);
