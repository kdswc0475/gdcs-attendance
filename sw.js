const CACHE = 'gdcs-v2';
const PRECACHE = ['./kiosk.html','./admin.html','./manifest-kiosk.json','./manifest-admin.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  if (e.request.url.includes('script.google.com')) {
    e.respondWith(fetch(e.request).catch(()=>new Response('{"error":"offline"}')));
    return;
  }
  e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request).then(r=>{
    const cl=r.clone(); caches.open(CACHE).then(cc=>cc.put(e.request,cl)); return r;
  })));
});
