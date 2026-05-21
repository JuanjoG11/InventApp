const CACHE_NAME = 'inventapp-cache-v2';
const urlsToCache = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    './jspdf.umd.min.js',
    './jspdf.plugin.autotable.min.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Opened cache');
                return cache.addAll(urlsToCache);
            })
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    const requestUrl = new URL(event.request.url);

    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then(networkResponse => {
                    if (networkResponse && networkResponse.status === 200) {
                        const cacheResponse = networkResponse.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, cacheResponse));
                    }
                    return networkResponse;
                })
                .catch(() => caches.match('./'))
        );
        return;
    }

    if (requestUrl.origin === location.origin) {
        const isAppShell = requestUrl.pathname.endsWith('/app.js')
            || requestUrl.pathname.endsWith('/index.html')
            || requestUrl.pathname.endsWith('/styles.css')
            || requestUrl.pathname.endsWith('/manifest.json');

        if (isAppShell) {
            event.respondWith(
                fetch(event.request)
                    .then(networkResponse => {
                        if (networkResponse && networkResponse.status === 200) {
                            const cacheResponse = networkResponse.clone();
                            caches.open(CACHE_NAME).then(cache => cache.put(event.request, cacheResponse));
                        }
                        return networkResponse;
                    })
                    .catch(() => caches.match(event.request))
            );
            return;
        }

        event.respondWith(
            caches.match(event.request).then(cacheResponse => {
                const fetchPromise = fetch(event.request)
                    .then(networkResponse => {
                        if (networkResponse && networkResponse.status === 200) {
                            const cacheResponse = networkResponse.clone();
                            caches.open(CACHE_NAME).then(cache => cache.put(event.request, cacheResponse));
                        }
                        return networkResponse;
                    })
                    .catch(() => cacheResponse);

                return cacheResponse || fetchPromise;
            })
        );
    } else {
        event.respondWith(
            fetch(event.request)
                .catch(() => caches.match(event.request))
        );
    }
});

self.addEventListener('activate', event => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
