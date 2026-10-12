/* ============================================================
 * ical.js — 把「日程 + 课程表 + 活动」导出为 .ics（RFC 5545，供系统日历导入）
 *
 *  · 日程：未完成、带开始时间，逐条 VEVENT
 *  · 课程：按教学周/单双周折算为每周重复事件（RRULE:FREQ=WEEKLY[;INTERVAL=2];COUNT=n）
 *  · 活动：未归档、带开始时间，逐条 VEVENT
 *  · 每条 VEVENT 带 VALARM（ACTION:DISPLAY + TRIGGER:-PT<n>M）
 *  · DTSTART/DTEND 用 TZID=Asia/Shanghai；DTSTAMP 用 UTC(Z)；UID 稳定（重复导入为更新而非新增）
 *  · 文本按 RFC 5545 转义；行按 75 字节（UTF-8）折叠
 * ============================================================ */
(function (global) {
  'use strict';

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtLocal(d) {
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
      'T' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
  }
  function fmtUTC(d) {
    return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) +
      'T' + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + 'Z';
  }
  function icsEsc(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }
  function addMin(hhmm, mins) {
    const sec = U.timeToSec(hhmm);
    if (sec === null) return hhmm;
    let t = Math.floor(sec / 60) + mins;
    if (t < 0) t = 0;
    if (t > 23 * 60 + 59) t = 23 * 60 + 59;
    return pad2(Math.floor(t / 60)) + ':' + pad2(t % 60);
  }
  function utf8Len(s) { return unescape(encodeURIComponent(s)).length; }
  function foldLine(line) {
    const LIMIT = 75;
    const chars = Array.from(line);
    const out = [];
    let cur = '';
    let bytes = 0;
    for (let i = 0; i < chars.length; i++) {
      const b = utf8Len(chars[i]);
      if (bytes + b > LIMIT && cur.length > 0) { out.push(cur); cur = ' '; bytes = 1; }
      cur += chars[i];
      bytes += b;
    }
    if (cur) out.push(cur);
    return out;
  }

  // 把一条 { uid,start,end,summary,desc,rrule,lead } 追加为 VEVENT
  function pushEvent(raw, ev) {
    raw.push('BEGIN:VEVENT');
    raw.push('UID:' + ev.uid);
    raw.push('DTSTAMP:' + fmtUTC(new Date()));
    raw.push('DTSTART;TZID=Asia/Shanghai:' + fmtLocal(ev.start));
    raw.push('DTEND;TZID=Asia/Shanghai:' + fmtLocal(ev.end));
    if (ev.rrule) raw.push('RRULE:' + ev.rrule);
    raw.push('SUMMARY:' + icsEsc(ev.summary || ''));
    if (ev.desc) raw.push('DESCRIPTION:' + icsEsc(ev.desc));
    if (ev.lead != null) {
      raw.push('BEGIN:VALARM');
      raw.push('ACTION:DISPLAY');
      raw.push('DESCRIPTION:' + icsEsc(ev.summary || '提醒'));
      raw.push('TRIGGER:-PT' + ev.lead + 'M');
      raw.push('END:VALARM');
    }
    raw.push('END:VEVENT');
  }

  // 把课程折算成每周重复事件
  function courseEvents(courses, schoolRec, lead) {
    const out = [];
    if (!schoolRec || !schoolRec.firstDate) return out;
    const firstDate = U.parseDate(schoolRec.firstDate);
    if (!firstDate) return out;
    const bells = schoolRec.bells || [];
    const totalWeeks = schoolRec.totalWeeks || 0;
    (courses || []).forEach(function (c) {
      let sw = Math.max(1, c.startWeek || 1);
      let ew = Math.min(totalWeeks || (c.endWeek || 1), c.endWeek || totalWeeks);
      if (!(ew >= sw)) return;
      const bi = (c.weekType === 'odd' || c.weekType === 'even');
      if (bi) {
        const wantOdd = c.weekType === 'odd';
        while (sw <= ew && (U.weekTypeOf(sw) === 'odd') !== wantOdd) sw++;
        if (sw > ew) return;
      }
      const b1 = U.bellOf(bells, c.startPeriod);
      const b2 = U.bellOf(bells, c.endPeriod);
      if (!b1 || !b1.s) return;
      const startTime = b1.s;
      const endTime = (b2 && b2.e) ? b2.e : addMin(startTime, 45);
      const mon = U.addDays(firstDate, (sw - 1) * 7);
      const day = U.addDays(mon, (c.day || 1) - 1);
      const ds = U.dateStr(day);
      const start = new Date(ds + 'T' + startTime + ':00');
      const end = new Date(ds + 'T' + endTime + ':00');
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return;
      const count = bi ? (Math.floor((ew - sw) / 2) + 1) : (ew - sw + 1);
      const desc = (c.place ? '地点：' + c.place : '') + (c.teacher ? (c.place ? '　' : '') + '老师：' + c.teacher : '');
      out.push({
        uid: 'course-' + c.id + '@campusplatform.app',
        start: start, end: end, summary: c.name, desc: desc,
        rrule: 'FREQ=WEEKLY;' + (bi ? 'INTERVAL=2;' : '') + 'COUNT=' + count,
        lead: lead
      });
    });
    return out;
  }

  function buildIcs(events) {
    const raw = [];
    raw.push('BEGIN:VCALENDAR');
    raw.push('VERSION:2.0');
    raw.push('PRODID:-//CampusPlatform//Campus Platform//ZH-CN');
    raw.push('CALSCALE:GREGORIAN');
    raw.push('METHOD:PUBLISH');
    (events || []).forEach(function (ev) { pushEvent(raw, ev); });
    raw.push('END:VCALENDAR');
    const folded = [];
    raw.forEach(function (line) { folded.push.apply(folded, foldLine(line)); });
    return folded.join('\r\n') + '\r\n';
  }

  const Ical = {
    /* 汇总为事件列表：
     * opts = { courses, activities, schoolRec, leadMinutes } */
    collect(schedules, opts) {
      opts = opts || {};
      const lead = (opts.leadMinutes == null || isNaN(parseInt(opts.leadMinutes, 10)) || parseInt(opts.leadMinutes, 10) < 0)
        ? 15 : parseInt(opts.leadMinutes, 10);
      const events = [];

      (schedules || []).forEach(function (s) {
        if (!s || s.done || !s.date) return;
        const sSec = U.timeToSec(s.start);
        if (sSec === null) return;                      // 全天日程无具体时间，跳过
        const start = new Date(s.date + 'T' + (s.start || '00:00') + ':00');
        if (isNaN(start.getTime())) return;
        const eSec = U.timeToSec(s.end);
        const durMin = (eSec !== null && eSec > sSec) ? Math.round((eSec - sSec) / 60) : 60;
        events.push({
          uid: 'campus-' + s.id + '@campusplatform.app',
          start: start, end: new Date(start.getTime() + durMin * 60000),
          summary: s.title || '日程', desc: s.note || '', lead: lead
        });
      });

      courseEvents(opts.courses, opts.schoolRec, lead).forEach(function (e) { events.push(e); });

      (opts.activities || []).forEach(function (a) {
        if (!a || a.archived || !a.date) return;
        const sSec = U.timeToSec(a.start);
        if (sSec === null) return;
        const start = new Date(a.date + 'T' + (a.start || '00:00') + ':00');
        if (isNaN(start.getTime())) return;
        const eSec = U.timeToSec(a.end);
        const durMin = (eSec !== null && eSec > sSec) ? Math.round((eSec - sSec) / 60) : 60;
        const desc = (a.type ? '类型：' + a.type : '') + (a.place ? (a.type ? '　' : '') + '地点：' + a.place : '') +
          (a.organizer ? '　主办：' + a.organizer : '') + (a.note ? '\n' + a.note : '');
        events.push({
          uid: 'activity-' + a.id + '@campusplatform.app',
          start: start, end: new Date(start.getTime() + durMin * 60000),
          summary: a.name || '活动', desc: desc, lead: lead
        });
      });

      return events;
    },

    // 兼容旧调用：仅日程
    build(schedules, leadMinutes) {
      const events = Ical.collect(schedules, { leadMinutes: leadMinutes });
      return { text: buildIcs(events), count: events.length };
    },

    // 汇总并生成 ics 文本
    buildAll(schedules, opts) {
      const events = Ical.collect(schedules, opts);
      return { text: buildIcs(events), count: events.length };
    }
  };

  global.Ical = Ical;
})(window);
