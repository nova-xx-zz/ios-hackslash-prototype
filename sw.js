// オフラインでも起動できるようにする Service Worker（PWA）。
// 方針は「ネットワーク優先・つながらない時だけキャッシュ」。オンラインなら常に最新のファイルを使うので、
// 更新の反映は従来どおり index.html の ?v= で行う（ここのバージョンを上げる必要はない）。
// 一度オンラインで開いたファイルをキャッシュに残し、機内モードなどで開いた時はそれを使う。
// キャッシュの形を変えた時だけ CACHE_NAME を変える（古いキャッシュは有効化時に消す）。
const CACHE_NAME = "questparty-v1";
const APP_SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icons/apple-touch-icon.png", "./icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 同じファイルの古い版（?v= 違い）はキャッシュから消し、最新の版だけを残す
async function putLatest(cache, request, response) {
  const url = new URL(request.url);
  if (url.search) {
    for (const old of await cache.keys()) {
      const u = new URL(old.url);
      if (u.pathname === url.pathname && u.search !== url.search) await cache.delete(old);
    }
  }
  await cache.put(request, response);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const res = await fetch(req);
      if (res && res.ok) event.waitUntil(putLatest(cache, req, res.clone()));
      return res;
    } catch (e) {
      const hit = await cache.match(req);
      if (hit) return hit;
      // ページ自体（ホーム画面からの起動など）はアプリの入口を返す
      if (req.mode === "navigate") return (await cache.match("./index.html")) || (await cache.match("./")) || Response.error();
      return Response.error();
    }
  })());
});
