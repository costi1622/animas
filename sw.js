/* Animas: aplicația merge și fără rețea pentru ecrane; cererile spre Claude și Runware merg mereu la rețea. */
const CACHE = 'animas-v17', LIB = 'animas-lib-1';   // 1.9.0: bibliotecile mari (vendor/, inclusiv FFmpeg) într-o copie care rămâne între versiuni
const CORE = ['./', 'index.html', 'app.js', 'runware.js', 'claude.js', 'face.js', 'body.js', 'post.js', 'story.js', 'callset.js', 'videoMerger.js', 'videoAnalyzer.js', 'continuityEngine.js', 'montaj.js', 'prompt.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'fonts/pjs-latin.woff2', 'fonts/pjs-latin-ext.woff2'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE.map(u => new Request(u, {cache:'reload'})))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('animas-') && k !== CACHE && k !== LIB).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if(e.request.method !== 'GET' || !e.request.url.startsWith(self.registration.scope)) return;
  // 1.9.1: codul se cere cu revalidare la GitHub (no-cache), ca să nu rămână pe copia „păstrează 10 minute”
  // codul aplicației: întâi rețeaua (versiunea nouă), apoi copia; bibliotecile mari (vendor/): întâi copia
  const big = u.pathname.includes('/vendor/');
  e.respondWith(big
    ? caches.match(e.request).then(r => r || fetch(e.request).then(x => { if(x.ok){ const y = x.clone(); caches.open(LIB).then(c => c.put(e.request, y)); } return x; }))
    : fetch(e.request, {cache:'no-cache'}).then(x => { if(x.ok){ const y = x.clone(); caches.open(CACHE).then(c => c.put(e.request, y)); } return x; }).catch(() => caches.match(e.request, {ignoreSearch:true}).then(r => r || caches.match('index.html'))));
});
