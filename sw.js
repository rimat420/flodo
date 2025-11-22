const CACHE_NAME = 'bahn-widget-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/style.css',
    '/app.js',
    '/manifest.json'
];

// Install service worker
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
    );
});

// Fetch with cache-first strategy for assets
self.addEventListener('fetch', event => {
    // API calls should always go to network
    if (event.request.url.includes('oebb.transport.rest')) {
        event.respondWith(
            fetch(event.request).catch(() => {
                // Return cached error response if offline
                return new Response(JSON.stringify({
                    error: 'Offline - keine Verbindung zum Server'
                }), {
                    headers: { 'Content-Type': 'application/json' }
                });
            })
        );
        return;
    }
    
    // For other resources, use cache first
    event.respondWith(
        caches.match(event.request)
            .then(response => response || fetch(event.request))
    );
});

// Clean up old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});