/* ============================================================
 * db.js — IndexedDB 数据库定义（Dexie）
 *
 * 表结构与桌面版本地 JSON 文件的对应关系：
 *   kv        ← data/settings.json（键值：currentSchool、scheduleRemind ...）
 *   schools   ← data/schools/<学校名>/（学校 + 课表设置：总周数/每天节数/开学日/作息钟点）
 *   courses   ← timetable.json 的 courses（web 版为每条课程补 id 主键）
 *   schedules ← data/schedule.json（日程，全局，不跟随学校）
 *   activities← activities.json（活动；archived=1 即“活动历史.txt”里的归档记录）
 *   notes     ← notes.json（课堂笔记，富文本 HTML）
 *   assets    ← assets/ 目录（笔记图片，二进制 Blob 直接入库）
 *
 * “不同学校分目录”在 IndexedDB 中改为每条业务记录带 school 字段过滤。
 * ============================================================ */
(function (global) {
  'use strict';

  const DB_NAME = 'CampusPlatformDB';
  const DB_VERSION = 1;

  const db = new Dexie(DB_NAME);

  db.version(DB_VERSION).stores({
    // 主键在前，逗号后为可查询索引；复合索引 [school+day] 用于课表按星期取课
    kv:         'key',
    schools:    'name',
    courses:    'id, school, day, [school+day]',
    schedules:  'id, date, done',
    activities: 'id, school, date, archived, [school+archived]',
    notes:      'id, school, subject, modified',
    assets:     'id, school'
    // 非索引字段（如 html、blob、bells、各文本字段）无需声明，Dexie 会整对象存储。
  });

  // v2：新增考试成绩模块两张表（exams 一场考试；scores 该场考试下的单科成绩）
  // Dexie 的 stores 为相对上一版的增量，这里只需声明新表，v1 的旧表自动保留。
  db.version(2).stores({
    exams:  'id, school, date, type, term, [school+date]',
    scores: 'id, school, examId, subject, [school+examId], [school+subject]'
  });

  // 所有业务表的固定顺序（导出 / 导入 / 清空时使用）
  const TABLES = ['kv', 'schools', 'courses', 'schedules', 'activities',
                  'exams', 'scores', 'notes', 'assets'];
  // 含二进制 Blob、需要在备份时做 base64 编码的表
  const BLOB_TABLES = ['assets'];

  global.AppDB = db;
  global.AppDBMeta = {
    NAME: DB_NAME,
    VERSION: DB_VERSION,
    TABLES: TABLES,
    BLOB_TABLES: BLOB_TABLES,
    APP_TAG: 'CampusPlatform',
    FORMAT: 1
  };
})(window);
