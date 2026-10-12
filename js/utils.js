/* ============================================================
 * utils.js — 纯函数工具：ID、日期/教学周/单双周/作息钟点、
 *            学校名清洗、活动排序、base64/Blob、图片占位符。
 * 逻辑与桌面版（C++/Qt AppData）保持一致。
 * 挂载为全局 window.U，无任何依赖，可直接在浏览器 / WebView 中运行。
 * ============================================================ */
(function (global) {
  'use strict';

  const U = {};

  /* ---------------- ID ---------------- */
  U.uuid = function () {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    // 兜底（老旧 WebView）
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };

  /* ---------------- 基础日期（均为本地时区，避免 new Date('yyyy-MM-dd') 的 UTC 偏移） ---------------- */
  U.pad2 = function (n) { return (n < 10 ? '0' : '') + n; };

  // Date -> 'yyyy-MM-dd'（本地）
  U.dateStr = function (date) {
    const d = date instanceof Date ? date : new Date();
    return d.getFullYear() + '-' + U.pad2(d.getMonth() + 1) + '-' + U.pad2(d.getDate());
  };

  U.todayStr = function () { return U.dateStr(new Date()); };

  // 'yyyy-MM-dd' -> 本地 Date（零点）；非法返回 null
  U.parseDate = function (s) {
    if (!s || typeof s !== 'string') return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), da = Number(m[3]);
    const d = new Date(y, mo - 1, da);
    if (isNaN(d.getTime())) return null;
    // 严格校验月 / 日范围，拒绝 2026-13-99 这类被 Date 自动进位的非法日期
    if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return null;
    return d;
  };

  U.addDays = function (date, n) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() + n);
    return d;
  };

  // 星期：1=周一 ... 7=周日（与 Qt QDate::dayOfWeek 一致；JS getDay 为 0=周日..6=周六）
  U.dayOfWeek = function (date) {
    return ((date.getDay() + 6) % 7) + 1;
  };

  // 该周周一的 Date
  U.mondayOfWeek = function (date) {
    return U.addDays(date, -(U.dayOfWeek(date) - 1));
  };

  // 两个本地零点日期相差的整数天（b - a）
  U.diffDays = function (a, b) {
    const da = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
    const db = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
    return Math.round((db - da) / 86400000);
  };

  // 当前时间 -> 'HH:mm'
  U.nowHHMM = function (d) {
    const x = d || new Date();
    return U.pad2(x.getHours()) + ':' + U.pad2(x.getMinutes());
  };
  U.nowDateTime = function (d) {
    const x = d || new Date();
    return U.dateStr(x) + ' ' + U.pad2(x.getHours()) + ':' + U.pad2(x.getMinutes());
  };

  /* ---------------- 教学周 / 单双周（对齐桌面版） ---------------- */
  // 由开学日（第 1 周周一）推算某天的教学周；<1（0）表示尚未开学
  U.weekNumberOf = function (firstDateStr, date) {
    const first = U.parseDate(firstDateStr);
    if (!first) return 1;
    const days = U.diffDays(first, date);
    if (days < 0) return 0;
    return Math.floor(days / 7) + 1;
  };

  // 奇数周 'odd'，偶数周 'even'
  U.weekTypeOf = function (week) {
    return week % 2 === 1 ? 'odd' : 'even';
  };

  // 某课程在指定教学周是否可见（周次范围 + 单双周）
  U.courseVisible = function (course, week) {
    if (week < course.startWeek || week > course.endWeek) return false;
    return course.weekType === 'all' || course.weekType === U.weekTypeOf(week);
  };

  /* ---------------- 作息钟点（方案 1，与桌面 defaultBells 一致） ---------------- */
  U.defaultBells = function () {
    return [
      { s: '08:00', e: '08:45' }, { s: '08:55', e: '09:40' },
      { s: '10:00', e: '10:45' }, { s: '10:55', e: '11:40' },
      { s: '14:00', e: '14:45' }, { s: '14:55', e: '15:40' },
      { s: '16:00', e: '16:45' }, { s: '16:55', e: '17:40' },
      { s: '19:00', e: '19:45' }, { s: '19:55', e: '20:40' }
    ];
  };

  // 'HH:mm' -> 当天秒数；空串/非法 -> null（表示无确定时间，即全天）
  U.timeToSec = function (hhmm) {
    if (!hhmm || typeof hhmm !== 'string') return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
    if (!m) return null;
    return Number(m[1]) * 3600 + Number(m[2]) * 60;
  };

  // 取某节（1-based）钟点 {s,e}，越界返回 null
  U.bellOf = function (bells, period) {
    if (!bells || period < 1 || period > bells.length) return null;
    return bells[period - 1] || null;
  };

  // 让 bells 长度与 periodsPerDay 一致（不足补默认/空，多余截断）
  U.ensureBells = function (bells, periodsPerDay) {
    const def = U.defaultBells();
    const out = (bells || []).slice(0, periodsPerDay);
    while (out.length < periodsPerDay) {
      const i = out.length;
      out.push(i < def.length ? def[i] : { s: '', e: '' });
    }
    return out;
  };

  /* ---------------- 课程查询（对齐桌面版） ---------------- */
  // 某天的课程（含教学周/单双周判断），按开始节次升序
  // tt 为学校记录 { firstDate,totalWeeks,bells,... }
  U.coursesForDate = function (courses, tt, date) {
    const w = U.weekNumberOf(tt && tt.firstDate, date);
    if (w < 1 || w > (tt.totalWeeks || 20)) return [];
    const dow = U.dayOfWeek(date);
    return courses
      .filter(function (c) { return c.day === dow && U.courseVisible(c, w); })
      .sort(function (a, b) { return a.startPeriod - b.startPeriod; });
  };

  // 当天还没结束的课，最多 limit 节
  U.upcomingCoursesToday = function (courses, tt, limit, now) {
    now = now || new Date();
    const all = U.coursesForDate(courses, tt, now);
    const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const r = all.filter(function (c) {
      const bell = U.bellOf(tt.bells, c.endPeriod);
      if (bell && U.timeToSec(bell.e) !== null && U.timeToSec(bell.e) <= nowSec) return false; // 已上完
      return true;
    });
    return r.slice(0, limit);
  };

  /* ---------------- 学校名清洗（与桌面 sanitizeSchoolName 一致） ---------------- */
  U.sanitizeSchoolName = function (raw) {
    let s = (raw == null ? '' : String(raw)).trim();
    '\\/:*?"<>|'.split('').forEach(function (ch) {
      s = s.split(ch).join('_');
    });
    s = s.replace(/[\n\r]/g, ' ').trim();
    return s;
  };

  /* ---------------- HTML 白名单净化（防脚本注入：导入备份 / 导入 PDF / 笔记正文） ----------------
   * 只保留富文本需要的标签与安全属性；移除 <script> 等危险元素、所有 on* 事件属性、
   * javascript:/vbscript: 伪协议、以及 style 中的 url() 与 expression()。 */
  const SAFE_TAGS = {
    B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, STRIKE: 1, DEL: 1, INS: 1, MARK: 1, SMALL: 1,
    SUB: 1, SUP: 1, SPAN: 1, DIV: 1, P: 1, BR: 1, HR: 1, FONT: 1, PRE: 1, CODE: 1,
    UL: 1, OL: 1, LI: 1, BLOCKQUOTE: 1,
    H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1,
    IMG: 1, A: 1, TABLE: 1, THEAD: 1, TBODY: 1, TR: 1, TD: 1, TH: 1
  };
  const SAFE_ATTRS = {
    '*': { style: 1, title: 1, align: 1, dir: 1 },
    IMG: { src: 1, alt: 1, width: 1, height: 1 },
    A: { href: 1, target: 1, rel: 1 },
    FONT: { color: 1, size: 1, face: 1 },
    TD: { colspan: 1, rowspan: 1 },
    TH: { colspan: 1, rowspan: 1 }
  };
  const DROP_TAGS = 'script,style,iframe,object,embed,link,meta,base,form,input,button,' +
    'textarea,select,option,svg,math,applet,frame,frameset,audio,video,source,track,canvas,template,noscript';
  const HAS_SCHEME = /^[a-z][a-z0-9+.\-]*:/i;
  function isSafeSrc(v) {
    const s = String(v).replace(/[\u0000-\u0020]/g, '');
    if (/^(asset:|blob:)/i.test(s)) return true;
    if (/^data:image\/(png|jpe?g|gif|webp|bmp)[;,]?/i.test(s)) return true;
    if (HAS_SCHEME.test(s)) return false;      // http/https/file/... 一律拒绝
    return true;                               // 相对路径
  }
  function isSafeHref(v) {
    const s = String(v).replace(/[\u0000-\u0020]/g, '');
    if (/^(https?:|mailto:|tel:)/i.test(s) || s.charAt(0) === '#') return true;
    if (HAS_SCHEME.test(s)) return false;      // javascript:/vbscript:/data: 等拒绝
    return true;                               // 相对路径
  }

  U.sanitizeHtml = function (html) {
    // 在“惰性文档”里解析，图片/脚本不会真正加载或执行
    const doc = document.implementation.createHTMLDocument('');
    const box = doc.createElement('div');
    box.innerHTML = String(html == null ? '' : html);
    // 1) 整段删除危险元素
    Array.prototype.slice.call(box.querySelectorAll(DROP_TAGS)).forEach(function (n) {
      if (n.parentNode) n.parentNode.removeChild(n);
    });
    // 2) 自底向上：非白名单标签“脱壳”保留文字，白名单标签过滤属性
    Array.prototype.slice.call(box.querySelectorAll('*')).reverse().forEach(function (el) {
      if (!el.parentNode) return;
      const tag = el.tagName;
      if (!SAFE_TAGS[tag]) {
        while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
        el.parentNode.removeChild(el);
        return;
      }
      const allow = Object.assign({}, SAFE_ATTRS['*'], SAFE_ATTRS[tag] || {});
      Array.prototype.slice.call(el.attributes).forEach(function (at) {
        const name = at.name.toLowerCase();
        const val = String(at.value);
        if (name.indexOf('on') === 0 || name === 'srcdoc' || name === 'formaction' || name === 'xlink:href') {
          el.removeAttribute(at.name); return;
        }
        if (!allow[name]) { el.removeAttribute(at.name); return; }
        if (name === 'src' && !isSafeSrc(val)) { el.removeAttribute(at.name); return; }
        if (name === 'href' && !isSafeHref(val)) { el.removeAttribute(at.name); return; }
        if (name === 'style') {
          el.setAttribute('style', val
            .replace(/url\s*\([^)]*\)/gi, '')
            .replace(/expression\s*\(/gi, '')
            .replace(/javascript:/gi, '')
            .replace(/[<>]/g, ''));
        }
      });
    });
    return box.innerHTML;
  };

  /* ---------------- 活动排序 / 归档判定（对齐桌面版） ---------------- */
  // 同一天活动：有开始时间的在前并按时间升序，全天（无时间）在后
  U.sortActivities = function (list) {
    return list.slice().sort(function (a, b) {
      const ta = U.timeToSec(a.start);
      const tb = U.timeToSec(b.start);
      if (ta !== null && tb !== null) return ta - tb || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      if (ta !== null) return -1; // a 有时间 -> a 在前
      if (tb !== null) return 1;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
  };

  // 活动结束时刻（Date）：有结束时间用结束时间，否则当天 23:59:59；日期非法返回 null
  U.activityEnd = function (act, now) {
    const d = U.parseDate(act.date);
    if (!d) return null;
    const e = U.timeToSec(act.end);
    if (e === null) {
      d.setHours(23, 59, 59, 0);
    } else {
      d.setHours(Math.floor(e / 3600), Math.floor((e % 3600) / 60), 0, 0);
    }
    return d;
  };

  // 活动六类（与桌面配色一致，UI 可取此列表）
  U.ACTIVITY_TYPES = ['社团', '比赛', '讲座', '志愿实践', '文体活动', '其他'];

  // 考试类型（成绩模块）
  U.EXAM_TYPES = ['月考', '期中', '期末', '模拟考', '其他'];

  /* ---------------- 笔记图片占位符 ---------------- */
  // 富文本正文里图片统一写作 <img src="asset:<uuid>">
  U.ASSET_PREFIX = 'asset:';
  U.assetRef = function (id) { return U.ASSET_PREFIX + id; };
  U.extractAssetIds = function (html) {
    const ids = [];
    const re = new RegExp(U.ASSET_PREFIX.replace(':', '\\:') + '([0-9a-fA-F-]{36})', 'g');
    let m;
    while ((m = re.exec(html || '')) !== null) {
      if (ids.indexOf(m[1]) === -1) ids.push(m[1]);
    }
    return ids;
  };
  // 用 id->url 映射把占位符替换为可显示的 URL
  U.replaceAssetRefs = function (html, urlMap) {
    return (html || '').replace(
      new RegExp(U.ASSET_PREFIX.replace(':', '\\:') + '([0-9a-fA-F-]{36})', 'g'),
      function (full, id) { return urlMap[id] || full; }
    );
  };

  /* ---------------- base64 / Blob（备份导入导出用） ---------------- */
  U.blobToDataURL = function (blob) {
    return new Promise(function (resolve, reject) {
      const fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error || new Error('readAsDataURL failed')); };
      fr.readAsDataURL(blob);
    });
  };

  U.dataURLToBlob = function (dataURL) {
    const m = /^data:([^;]+)?(;base64)?,(.*)$/.exec(dataURL || '');
    if (!m) throw new Error('非法的 dataURL');
    const mime = m[1] || 'application/octet-stream';
    const b64 = m[3];
    const bin = global.atob ? global.atob(b64) : '';
    const len = bin.length;
    const buf = new Uint8Array(len);
    for (let i = 0; i < len; i++) buf[i] = bin.charCodeAt(i);
    return new Blob([buf], { type: mime });
  };

  // 触发浏览器 / WebView 下载一段文本内容
  U.downloadText = function (filename, text, mime) {
    U.downloadBlob(filename, new Blob([text], { type: mime || 'application/json;charset=utf-8' }));
  };

  // 触发浏览器 / WebView 下载一个 Blob
  U.downloadBlob = function (filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  };

  global.U = U;
})(window);
