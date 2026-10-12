/* 校园任务平台 · Service Worker（离线缓存）
 * 版本变更请同时修改 CACHE 名称，以触发缓存更新。 */
const CACHE = 'campus-platform-v7';
const ASSETS = [
  "./",
  "./css/app.css",
  "./css/selftest.css",
  "./icons/add.png",
  "./icons/apple-touch-icon.png",
  "./icons/archive.png",
  "./icons/arrow_left.png",
  "./icons/arrow_right.png",
  "./icons/back_home.png",
  "./icons/bell.png",
  "./icons/delete.png",
  "./icons/history.png",
  "./icons/home.png",
  "./icons/module_activity.png",
  "./icons/module_notes.png",
  "./icons/module_schedule.png",
  "./icons/module_scores.png",
  "./icons/module_timetable.png",
  "./icons/pwa-192.png",
  "./icons/pwa-512.png",
  "./icons/pwa-maskable-512.png",
  "./icons/school.png",
  "./icons/search.png",
  "./icons/settings.png",
  "./icons/view_calendar.png",
  "./icons/view_cards.png",
  "./icons/view_list.png",
  "./index.html",
  "./js/app.js",
  "./js/db.js",
  "./js/ical.js",
  "./js/pdf.js",
  "./js/selftest.js",
  "./js/store.js",
  "./js/utils.js",
  "./js/vendor/dexie.min.js",
  "./js/views/activity.js",
  "./js/views/home.js",
  "./js/views/notes.js",
  "./js/views/schedule.js",
  "./js/views/scores.js",
  "./js/views/timetable.js",
  "./selftest.html",
  "./使用说明.md",
  "./部署说明.md"
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      });
    })
  );
});
