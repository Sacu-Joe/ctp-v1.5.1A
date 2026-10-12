/* ============================================================
 * views/notes.js — 课堂笔记模块（数据按学校保存）
 *  · 左栏：关键词搜索 + 科目筛选（全部科目 / 课程名 + 自定义科目）+ 笔记列表（修改时间倒序）
 *  · 右栏：标题、科目（可手动输入新科目，datalist 联想）、富文本编辑器
 *          （加粗 / 斜体 / 下划线 / 字号 / 文字颜色 / 对齐 / 无序列表 / 插图）
 *  · 图片以 Blob 存入 IndexedDB，正文保存为 asset:<id>；显示时换成临时 blob: URL
 *  · 编辑后短时自动保存（防切走丢失），也可手动保存；删除笔记后清理孤儿图片
 * ============================================================ */
(function (global) {
  'use strict';

  const FONT_SIZES = ['12', '14', '16', '18', '24', '32'];

  // 跨 mount 保留的状态（切换学校时重置）
  const view = {
    school: null,
    all: [],
    subjects: [],
    currentId: null,
    dirty: false,
    syncing: false,
    keyword: '',
    filter: '全部科目',
    idToUrl: {},
    urlToId: {},
    urls: [],
    saveTimer: null,
    mode: 'list'
  };

  function pad2(n) { return U.pad2(n); }
  function fmtList(iso) {
    const d = new Date(iso);
    return pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function fmtFull(iso) {
    const d = new Date(iso);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function fmtClock(iso) {
    const d = new Date(iso);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }
  function plainText(html) {
    const div = document.createElement('div');
    div.innerHTML = U.sanitizeHtml(html || '');   // 净化后再解析，避免 onerror 之类被触发
    return (div.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // 图片缩放到最大宽 maxW（gif 保留原文件以保留动画），返回 Blob
  function scaleImage(file, maxW) {
    return new Promise(function (resolve, reject) {
      if (/gif/i.test(file.type || '') || /\.gif$/i.test(file.name || '')) { resolve(file); return; }
      const orig = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () {
        let w = img.width, h = img.height;
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(orig);
        const mime = /^image\//.test(file.type || '') ? file.type : 'image/png';
        cv.toBlob(function (b) { resolve(b || file); }, mime === 'image/gif' ? 'image/png' : mime, 0.92);
      };
      img.onerror = function () { URL.revokeObjectURL(orig); reject(new Error('图片读取失败')); };
      img.src = orig;
    });
  }

  view.mount = async function (root) {
    const newSchool = App.state.school;
    if (view.school && view.school !== newSchool) {
      // 切换学校：笔记是另一份，释放图片临时 URL 并重置编辑器状态
      revokeAll();
      clearTimer();
      view.currentId = null; view.dirty = false;
      view.keyword = ''; view.filter = '全部科目';
    }
    view.school = newSchool;
    view.mode = 'list'; // 每次进入默认列表视图

    const sizeOpts = FONT_SIZES.map(function (s) {
      return '<option value="' + s + '"' + (s === '14' ? ' selected' : '') + '>' + s + '</option>';
    }).join('');
    const v = App.el('div', 'view');
    v.innerHTML =
      '<div class="notes-wrap">' +
      '<div class="notes-bar"><div class="n-title-col">' +
      '<div class="nt">课堂笔记</div></div>' +
      '<div class="spacer" style="flex:1"></div>' +
      '<div class="n-tabs">' +
      '<button class="n-tab active" id="nTabList" type="button">📋 列表</button>' +
      '<button class="n-tab" id="nTabEdit" type="button">✏️ 编辑</button></div>' +
      '<button class="btn-add" id="nNew" type="button">' + App.icon('add', 'ico-white') + '新建</button></div>' +
      '<div class="notes-split mode-list" id="nSplit">' +
      '<aside class="notes-left">' +
      '<input class="n-search" id="nSearch" type="text" placeholder="🔍 搜索标题 / 科目 / 正文">' +
      '<select class="n-filter" id="nFilter"></select>' +
      '<div class="notes-list" id="nList"></div></aside>' +
      '<section class="notes-right is-off" id="nRight">' +
      '<div class="n-head">' +
      '<input id="nTitle" type="text" placeholder="笔记标题" maxlength="80">' +
      '<input id="nSubject" type="text" list="nSubjectList" placeholder="科目（可输入）" maxlength="30">' +
      '<datalist id="nSubjectList"></datalist></div>' +
      '<div class="n-toolbar">' +
      '<button class="n-tbtn" id="nCmdBold" type="button" title="加粗"><b>B</b></button>' +
      '<button class="n-tbtn" id="nCmdItalic" type="button" title="斜体"><i>I</i></button>' +
      '<button class="n-tbtn" id="nCmdUnder" type="button" title="下划线"><span style="text-decoration:underline">U</span></button>' +
      '<select id="nFontSize" title="字号">' + sizeOpts + '</select>' +
      '<button class="n-tbtn" id="nColor" type="button" title="文字颜色"><b id="nColorGlyph" style="color:#1f2933">A</b></button>' +
      '<input id="nColorInput" type="color" value="#1f2933" style="display:none">' +
      '<span class="n-sep"></span>' +
      '<button class="n-tbtn" id="nAlignL" type="button" title="左对齐">⇤</button>' +
      '<button class="n-tbtn" id="nAlignC" type="button" title="居中">≡</button>' +
      '<button class="n-tbtn" id="nAlignR" type="button" title="右对齐">⇥</button>' +
      '<button class="n-tbtn" id="nListBtn" type="button" title="无序列表">• 列表</button>' +
      '<span class="n-sep"></span>' +
      '<button class="n-tbtn n-imgbtn" id="nImgBtn" type="button">🖼 插入图片</button>' +
      '<input id="nImgFile" type="file" accept="image/png,image/jpeg,image/gif,image/bmp" style="display:none">' +
      '</div>' +
      '<div class="n-editor" id="nEditor" contenteditable="false"></div>' +
      '<div class="n-foot"><div class="n-status" id="nStatus">选择左侧笔记，或点击右上角「新建笔记」</div>' +
      '<button class="btn n-btn-del" id="nDel" type="button">删除</button>' +
      '<button class="btn btn-primary" id="nSave" type="button">保存</button></div>' +
      '</section></div></div>';
    root.appendChild(v);

    const searchEl = v.querySelector('#nSearch');
    const filterEl = v.querySelector('#nFilter');
    const listEl = v.querySelector('#nList');
    const subjectData = v.querySelector('#nSubjectList');
    const right = v.querySelector('#nRight');
    const titleEl = v.querySelector('#nTitle');
    const subjectEl = v.querySelector('#nSubject');
    const editor = v.querySelector('#nEditor');
    const statusEl = v.querySelector('#nStatus');
    const boldBtn = v.querySelector('#nCmdBold');
    const italicBtn = v.querySelector('#nCmdItalic');
    const underBtn = v.querySelector('#nCmdUnder');
    const fontSizeEl = v.querySelector('#nFontSize');
    const colorGlyph = v.querySelector('#nColorGlyph');
    const colorInput = v.querySelector('#nColorInput');
    const imgFile = v.querySelector('#nImgFile');

    /* ---------- 图片临时 URL ---------- */
    function revokeAll() {
      Store.Images.revokeUrls(view.urls);
      view.urls = []; view.idToUrl = {}; view.urlToId = {};
    }
    function clearTimer() { if (view.saveTimer) { clearTimeout(view.saveTimer); view.saveTimer = null; } }

    /* ---------- 数据 / 列表 / 科目 ---------- */
    async function reloadData() {
      view.all = await Store.listNotes(view.school);
      view.subjects = await Store.subjects(view.school);
    }
    function renderFilter() {
      filterEl.innerHTML = '<option value="全部科目">全部科目</option>' +
        view.subjects.map(function (s) { return '<option value="' + App.esc(s) + '">' + App.esc(s) + '</option>'; }).join('');
      filterEl.value = view.subjects.indexOf(view.filter) >= 0 || view.filter === '全部科目' ? view.filter : '全部科目';
      view.filter = filterEl.value;
      subjectData.innerHTML = view.subjects.map(function (s) {
        return '<option value="' + App.esc(s) + '"></option>';
      }).join('');
    }
    function renderList() {
      const kw = view.keyword.trim().toLowerCase();
      const subj = view.filter;
      const rows = view.all.filter(function (n) {
        if (subj !== '全部科目' && (n.subject || '').trim() !== subj) return false;
        if (kw) {
          const hay = (n.title + ' ' + (n.subject || '') + ' ' + plainText(n.html)).toLowerCase();
          if (hay.indexOf(kw) < 0) return false;
        }
        return true;
      });
      listEl.innerHTML = '';
      if (!rows.length) {
        listEl.appendChild(App.el('div', 'notes-empty', view.keyword || view.filter !== '全部科目'
          ? '（没有符合条件的笔记）' : '还没有笔记，点击右上角「新建笔记」'));
        return;
      }
      rows.forEach(function (n) {
        const item = App.el('div', 'note-item' + (n.id === view.currentId ? ' active' : ''));
        const t = (n.title || '').trim() || '未命名笔记';
        const s = (n.subject || '').trim() || '未分类';
        item.innerHTML = '<div class="ni-t">' + App.esc(t) + '</div>' +
          '<div class="ni-m">' + App.esc(s) + ' · ' + App.esc(fmtList(n.modified)) + '</div>';
        item.addEventListener('click', function () { onSelect(n.id); });
        listEl.appendChild(item);
      });
    }

    /* ---------- 编辑器状态 ---------- */
    function setEnabled(on) {
      right.classList.toggle('is-off', !on);
      editor.setAttribute('contenteditable', on ? 'true' : 'false');
    }
    // 列表 / 编辑 切换：选中一侧全屏显示，另一侧隐藏
    function setMode(mode) {
      view.mode = mode === 'editor' ? 'editor' : 'list';
      const split = v.querySelector('#nSplit');
      split.classList.toggle('mode-editor', view.mode === 'editor');
      split.classList.toggle('mode-list', view.mode === 'list');
      v.querySelector('#nTabList').classList.toggle('active', view.mode === 'list');
      v.querySelector('#nTabEdit').classList.toggle('active', view.mode === 'editor');
    }
    function clearEditor() {
      revokeAll();
      view.currentId = null; view.dirty = false; clearTimer();
      view.syncing = true;
      titleEl.value = ''; subjectEl.value = ''; editor.innerHTML = '';
      view.syncing = false;
      setEnabled(false);
      statusEl.textContent = '选择左侧笔记，或点击右上角「新建笔记」';
    }
    async function loadNote(id) {
      const n = await Store.getNote(id);
      if (!n) { clearEditor(); return; }
      revokeAll();
      view.currentId = id; view.dirty = false; clearTimer();
      view.syncing = true;
      titleEl.value = n.title || '';
      subjectEl.value = n.subject || '';
      const ids = U.extractAssetIds(n.html || '');
      for (const aid of ids) {
        const blob = await Store.Images.getBlob(aid);
        if (blob) {
          const u = URL.createObjectURL(blob);
          view.idToUrl[aid] = u; view.urlToId[u] = aid; view.urls.push(u);
        }
      }
      editor.innerHTML = U.replaceAssetRefs(U.sanitizeHtml(n.html || ''), view.idToUrl);
      view.syncing = false;
      setEnabled(true);
      syncToolbar();
      statusEl.textContent = '已保存 · 最后修改 ' + fmtFull(n.modified);
    }
    async function onSelect(id) {
      if (id === view.currentId) { setMode('editor'); return; }
      await flushSave();
      await loadNote(id);
      setMode('editor');
    }

    /* ---------- 保存 ---------- */
    function toSavedHtml() {
      let html = editor.innerHTML;
      Object.keys(view.urlToId).forEach(function (u) {
        html = html.split(u).join(U.assetRef(view.urlToId[u]));
      });
      return html;
    }
    async function doSave(silent) {
      if (!view.currentId) return false;
      clearTimer();
      const rec = {
        title: titleEl.value.trim(),
        subject: subjectEl.value.trim(),
        html: toSavedHtml()
      };
      await Store.putNote(view.school, { id: view.currentId, title: rec.title, subject: rec.subject, html: rec.html });
      try { await Store.Images.cleanupOrphans(view.school); } catch (e) { /* 忽略清理异常 */ }
      view.dirty = false;
      await reloadData();
      renderFilter();
      renderList();
      const cur = await Store.getNote(view.currentId);
      statusEl.textContent = silent ? ('已保存 · 最后修改 ' + fmtFull(cur.modified)) : ('已保存 · ' + fmtClock(cur.modified));
      return true;
    }
    async function flushSave() {
      if (view.dirty && view.currentId) { try { await doSave(true); } catch (e) { /* 忽略自动保存异常 */ } }
    }
    function markDirty() {
      if (view.syncing || !view.currentId) return;
      if (!view.dirty) { view.dirty = true; statusEl.textContent = '有未保存的修改…'; }
      clearTimer();
      view.saveTimer = setTimeout(function () { doSave(true).catch(function () {}); }, 1200);
    }

    /* ---------- 新建 / 删除 ---------- */
    async function newNote() {
      await flushSave();
      const subj = view.filter !== '全部科目' ? view.filter : '';
      const rec = await Store.putNote(view.school, { title: '', subject: subj, html: '' });
      view.keyword = ''; searchEl.value = '';
      view.filter = '全部科目';
      await reloadData();
      renderFilter();
      renderList();
      await loadNote(rec.id);
      setMode('editor');
      titleEl.focus();
      statusEl.textContent = '新笔记，编辑后会自动保存，也可点「保存」';
    }
    async function deleteCurrent() {
      if (!view.currentId) return;
      const n = await Store.getNote(view.currentId);
      const t = (n && (n.title || '').trim()) || '这篇笔记';
      const ok = await App.confirm('确定删除「' + t + '」吗？此操作不可恢复。',
        { title: '删除笔记', okText: '删除' });
      if (!ok) return;
      await Store.deleteNote(view.currentId);
      try { await Store.Images.cleanupOrphans(view.school); } catch (e) { /* 忽略 */ }
      revokeAll();
      view.currentId = null; view.dirty = false; clearTimer();
      await reloadData();
      renderFilter();
      renderList();
      if (view.all.length) await loadNote(view.all[0].id); else clearEditor();
      App.toast('已删除笔记', 'ok');
    }

    /* ---------- 富文本命令 ---------- */
    function exec(cmd, val) {
      editor.focus();
      try { document.execCommand(cmd, false, val || null); } catch (e) { /* 老旧 WebView 兜底忽略 */ }
      markDirty();
      syncToolbar();
    }
    function syncToolbar() {
      try {
        boldBtn.classList.toggle('active', document.queryCommandState('bold'));
        italicBtn.classList.toggle('active', document.queryCommandState('italic'));
        underBtn.classList.toggle('active', document.queryCommandState('underline'));
      } catch (e) { /* 忽略 */ }
    }
    function applyFontSize(px) {
      editor.focus();
      try {
        document.execCommand('styleWithCSS', false, false);
        document.execCommand('fontSize', false, '7');
      } catch (e) { /* 忽略 */ }
      const fonts = editor.querySelectorAll('font[size="7"]');
      fonts.forEach(function (f) {
        const s = document.createElement('span');
        s.style.fontSize = px + 'px';
        while (f.firstChild) s.appendChild(f.firstChild);
        f.parentNode.replaceChild(s, f);
      });
      markDirty();
    }

    /* ---------- 事件绑定 ---------- */
    searchEl.value = view.keyword;
    searchEl.addEventListener('input', function () { view.keyword = searchEl.value; renderList(); });
    filterEl.addEventListener('change', function () { view.filter = filterEl.value; renderList(); });
    titleEl.addEventListener('input', markDirty);
    subjectEl.addEventListener('input', markDirty);
    editor.addEventListener('input', markDirty);
    editor.addEventListener('keyup', syncToolbar);
    editor.addEventListener('mouseup', syncToolbar);
    editor.addEventListener('focus', syncToolbar);
    // 双击笔记里的图片 → 放大查看
    editor.addEventListener('dblclick', function (e) {
      const t = e.target;
      if (t && t.tagName === 'IMG' && t.src) {
        e.preventDefault();
        App.openImageZoom(t.src);
      }
    });

    /* ---------- 编辑区双指缩放（仅内容缩放，工具栏固定） ---------- */
    let eZoom = 1;
    function edist(t) {
      const dx = t[0].clientX - t[1].clientX;
      const dy = t[0].clientY - t[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }
    let epinch = null;
    editor.addEventListener('touchstart', function (e) {
      if (e.touches.length === 2) epinch = { d: edist(e.touches), z: eZoom };
    }, { passive: false });
    editor.addEventListener('touchmove', function (e) {
      if (e.touches.length === 2 && epinch && epinch.d > 0) {
        eZoom = Math.min(2, Math.max(0.6, +(epinch.z * edist(e.touches) / epinch.d).toFixed(2)));
        editor.style.zoom = eZoom;
        e.preventDefault();
      }
    }, { passive: false });
    editor.addEventListener('touchend', function (e) { if (e.touches.length < 2) epinch = null; });
    editor.addEventListener('touchcancel', function () { epinch = null; });

    v.querySelector('#nTabList').addEventListener('click', function () { setMode('list'); });
    v.querySelector('#nTabEdit').addEventListener('click', function () { setMode('editor'); });
    v.querySelector('#nNew').addEventListener('click', function () { newNote().catch(function (e) { App.toast(e.message, 'err'); }); });
    v.querySelector('#nSave').addEventListener('click', function () {
      doSave(false).then(function () { App.toast('已保存笔记', 'ok'); }).catch(function (e) { App.toast(e.message, 'err'); });
    });
    v.querySelector('#nDel').addEventListener('click', function () { deleteCurrent().catch(function (e) { App.toast(e.message, 'err'); }); });

    boldBtn.addEventListener('click', function () { exec('bold'); });
    italicBtn.addEventListener('click', function () { exec('italic'); });
    underBtn.addEventListener('click', function () { exec('underline'); });
    v.querySelector('#nAlignL').addEventListener('click', function () { exec('justifyLeft'); });
    v.querySelector('#nAlignC').addEventListener('click', function () { exec('justifyCenter'); });
    v.querySelector('#nAlignR').addEventListener('click', function () { exec('justifyRight'); });
    v.querySelector('#nListBtn').addEventListener('click', function () { exec('insertUnorderedList'); });
    fontSizeEl.addEventListener('change', function () { applyFontSize(fontSizeEl.value); });
    v.querySelector('#nColor').addEventListener('click', function () { colorInput.click(); });
    colorInput.addEventListener('input', function () {
      editor.focus();
      try { document.execCommand('foreColor', false, colorInput.value); } catch (e) { /* 忽略 */ }
      colorGlyph.style.color = colorInput.value;
      markDirty();
    });
    v.querySelector('#nImgBtn').addEventListener('click', function () { imgFile.click(); });
    imgFile.addEventListener('change', async function () {
      const file = imgFile.files[0];
      imgFile.value = '';
      if (!file || !view.currentId) return;
      try {
        const blob = await scaleImage(file, 600);
        const id = await Store.Images.put(view.school, blob, { name: file.name });
        const u = URL.createObjectURL(blob);
        view.idToUrl[id] = u; view.urlToId[u] = id; view.urls.push(u);
        editor.focus();
        try { document.execCommand('insertImage', false, u); } catch (e) { /* 忽略 */ }
        markDirty();
        App.toast('已插入图片，点击「保存」生效', 'ok');
      } catch (e) { App.toast(e.message || '图片插入失败', 'err'); }
    });

    /* ---------- 初始数据 ---------- */
    await reloadData();
    renderFilter();
    renderList();
    if (view.currentId && view.all.some(function (n) { return n.id === view.currentId; })) {
      await loadNote(view.currentId);
    } else if (view.all.length) {
      await loadNote(view.all[0].id);
    } else {
      clearEditor();
    }
  };

  global.App.views.notes = view;
})(window);
