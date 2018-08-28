let staticCacheName = 'reviews-static-v1';
let contentImgsCache = 'reviews-content-imgs';

let urlsToCache = [
    '/',
    '/index.html',
    '/restaurant.html',
    '/css/styles.css',
    '/js/all.js',
    '/js/restaurant_info.js',
    '/js/main.js',
    '/manifest.json'
    //'/data/restaurants.json',
    // '/js/dbhelper.js',
    // '/js/main.js',
    // '/js/restaurant_info.js',
    // '/js/sw_register.js'
];


self.addEventListener("install", function (event) {
    console.log("service worker installed.");
    //caching or creating the cache.
    event.waitUntil(
        caches.open(staticCacheName).then(function (cache) {
            console.log("caching");
            return cache.addAll(urlsToCache);
        })
    );
});

self.addEventListener('fetch', function(event) {
    var requestUrl = new URL(event.request.url);

    if (requestUrl.origin === location.origin) {
      if (requestUrl.pathname.startsWith('/img/')) {
        event.respondWith(servePhoto(event.request));
        return;
      }
    }

    event.respondWith(
      caches.match(event.request, {'ignoreSearch':true}).then(function(response) {
        return response || fetch(event.request);
      })
    );
  });

  function servePhoto(request) {
    var storageUrl = request.url.replace(/-[small|medium|large]\.jpg$/, '');

    return caches.open(contentImgsCache).then(function(cache) {
      return cache.match(storageUrl).then(function(response) {
        if (response) return response;

        return fetch(request).then(function(networkResponse) {
          cache.put(storageUrl, networkResponse.clone());
          return networkResponse;
        });
      });
    });
  }



