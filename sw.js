/* Qberries Lunch Admin · shell cache v3. No cachea la API. */
var CACHE = "qberries-shell-v3";
var SHELL = [
  "./",
  "./index.html",
  "./css/app.css",
  "./js/config.js",
  "./js/store.js",
  "./js/api.js",
  "./js/report.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./favicon.ico",
  "./icon-192.png",
  "./logo-qberries.png",
  "./jefe.png",
  "./entrada.png",
  "./comida1.png",
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(function (cache) {
        return Promise.all(
          SHELL.map(function (url) {
            return cache.add(url).catch(function () {});
          })
        );
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys.map(function (key) {
            if (key !== CACHE) return caches.delete(key);
          })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function isApi(url) {
  return url.hostname.indexOf("script.google") !== -1 || url.hostname.indexOf("googleusercontent") !== -1;
}

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url;
  try {
    url = new URL(req.url);
  } catch (err) {
    return;
  }
  if (url.origin !== self.location.origin) {
    if (isApi(url)) return;
    return;
  }
  if (url.pathname.indexOf("/sw.js") !== -1) return;

  var isDoc = req.mode === "navigate" || url.pathname === "/" || /index\.html$/i.test(url.pathname);
  if (isDoc) {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(CACHE).then(function (cache) {
              cache.put("./index.html", copy);
            });
          }
          return res;
        })
        .catch(function () {
          return caches.match("./index.html").then(function (hit) {
            return hit || caches.match(req);
          });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(function (hit) {
      var fetched = fetch(req)
        .then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(CACHE).then(function (cache) {
              cache.put(req, copy);
            });
          }
          return res;
        })
        .catch(function () {
          return hit || Response.error();
        });
      return hit || fetched;
    })
  );
});
