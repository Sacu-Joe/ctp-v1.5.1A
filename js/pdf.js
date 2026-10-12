/* ============================================================
 * pdf.js — 课堂笔记的 PDF 导出 / 导入（无第三方依赖）
 *
 * 采用「可见说明页 + 内嵌数据」的 PDF：一页英文字面说明，把笔记完整数据
 * （标题 / 科目 / 富文本 HTML / 图片 base64）以 JSON 的形式 base64 后
 * 写入 PDF 的 /Keywords 信息字段，导入时按同字段原样取回，做到导出/导入
 * 前后笔记完全一致（图片以 asset:<id> 占位 + dataURL 内联，重建时 id 不变）。
 * ============================================================ */
(function (global) {
  'use strict';

  const FORMAT = 'campus-platform.notes.v1';

  function utf8ToB64(str) { return btoa(unescape(encodeURIComponent(str))); }
  function b64ToUtf8(b64) { return decodeURIComponent(escape(atob(b64))); }

  // PDF 字符串转义（仅需处理括号与反斜杠；base64 不含这两者）
  function esc(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  // 生成最小合法 PDF（内容全为 ASCII，便于 .length 即字节长度）
  function buildPdf(textLines, json) {
    const payload = utf8ToB64(json);
    const lines = (textLines && textLines.length) ? textLines : ['Campus Platform - Notes Export'];
    let stream = 'BT /F1 12 Tf 60 730 Td 18 TL\n';
    lines.forEach(function (ln) { stream += '(' + esc(ln) + ') Tj T*\n'; });
    stream += 'ET';

    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
      '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      '<< /Title (Campus Platform Notes) /Author (CampusPlatform) /Keywords (CPNOTES:' + payload + ') >>'
    ];

    let pdf = '%PDF-1.4\n';
    const offsets = [];
    for (let i = 0; i < objects.length; i++) {
      offsets.push(pdf.length);
      pdf += (i + 1) + ' 0 obj\n' + objects[i] + '\nendobj\n';
    }
    const xrefStart = pdf.length;
    pdf += 'xref\n0 ' + (objects.length + 1) + '\n';
    pdf += '0000000000 65535 f \n';
    for (let i = 0; i < offsets.length; i++) {
      pdf += ('0000000000' + offsets[i]).slice(-10) + ' 00000 n \n';
    }
    pdf += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R /Info 6 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF\n';
    return pdf;
  }

  function parsePdf(text) {
    const m = String(text).match(/\/Keywords\s*\(\s*CPNOTES:([^)]*)\)/);
    if (!m) throw new Error('该 PDF 中未找到可导入的笔记数据');
    return b64ToUtf8(m[1]);
  }

  const Pdf = {
    FORMAT: FORMAT,

    // 导出某学校全部笔记为一个 PDF Blob
    async exportNotes(school) {
      const notes = await Store.listNotes(school);
      const used = new Set();
      notes.forEach(function (n) { U.extractAssetIds(n.html || '').forEach(function (id) { used.add(id); }); });
      const assets = [];
      for (const id of used) {
        const r = await Store.Images.getRecord(id);
        if (r && r.blob) {
          assets.push({ id: id, mime: r.mime, name: r.name, dataURL: await U.blobToDataURL(r.blob) });
        }
      }
      const payload = JSON.stringify({
        app: 'CampusPlatform',
        format: FORMAT,
        school: school,
        exportedAt: new Date().toISOString(),
        notes: notes.map(function (n) {
          return { id: n.id, title: n.title, subject: n.subject, html: n.html, created: n.created, modified: n.modified };
        }),
        assets: assets
      });
      const lines = [
        'Campus Platform - Notes Export',
        'Notes: ' + notes.length,
        'Open this PDF in the app (Notes > Import PDF) to restore the notes.'
      ];
      return new Blob([buildPdf(lines, payload)], { type: 'application/pdf' });
    },

    // 解析笔记 PDF，返回 payload（含 notes 与 assets）
    async importNotes(file) {
      const text = await file.text();
      let obj;
      try { obj = JSON.parse(parsePdf(text)); } catch (e) { throw new Error('解析 PDF 失败：' + (e && e.message ? e.message : e)); }
      if (!obj || obj.format !== FORMAT || !Array.isArray(obj.notes)) {
        throw new Error('不是有效的课堂笔记 PDF 文件');
      }
      return obj;
    }
  };

  global.Pdf = Pdf;
})(window);
