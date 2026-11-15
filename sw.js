/* 我们的小日子 - 离线缓存:所有文件都在第一次打开时缓存,之后断网也能用 */
const CACHE = 'lovedays-v10';
const ASSETS = ['./', './index.html', './core.js', './cloud.js', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-512-maskable.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  /* cache:'reload' 强制绕过 HTTP 缓存,确保每次装的都是服务器上的最新文件 */
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(ASSETS.map(a => c.add(new Request(a, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 缓存优先:一旦缓存过,即使托管服务器消失也照常能用 */
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  let url;
  try { url = new URL(e.request.url); } catch (err) { return; }
  /* 关键:云端 API(github.com 等)绝不缓存、一律直连,否则同步会读到旧数据 */
  if (url.host !== location.host) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(resp => {
      const copy = resp.clone();
      if (resp.ok) caches.open(CACHE).then(c => c.put(e.request, copy));
      return resp;
    }).catch(() => caches.match('./index.html')))
  );
});
