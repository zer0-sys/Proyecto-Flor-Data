const CACHE_NAME = 'flor-data-cache-v1';
// Lista de archivos vitales que deben funcionar sin internet
const urlsToCache = [
    '/',
    '/index.html',
    '/style.css',
    '/ia-chat.js',
    '/planta.html'
];

// Instalación: Se descargan los archivos al teléfono/PC
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Archivos cacheados para uso offline');
                return cache.addAll(urlsToCache);
            })
    );
});

// Intercepción: Cuando la app pide algo, revisamos si hay WiFi. Si no, usamos la caché.
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Si lo encuentra en la caché, lo devuelve. Si no, intenta bajarlo de internet.
                return response || fetch(event.request);
            })
    );
});