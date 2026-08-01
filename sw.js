// sw.js. Gameknight's service worker.
//
// It exists for two reasons: a page is only installable if a service worker
// with a fetch handler controls it, and once one exists the shelf may as well
// work on a train with no signal.
//
// THE RULE THAT MATTERS: this site is republished on every push to main, and
// data/games.json is rewritten by the weekly Action. A plain cache-first worker
// would pin visitors to whatever they saw first and quietly serve last month's
// shelf forever. So:
//
//   navigations and games.json  network first, cache only as a fallback
//   everything else same-origin stale-while-revalidate, so a stale asset is
//                               used once and replaced in the background
//   cross-origin                not intercepted at all
//
// Fonts and BGG's images are cross-origin and left to the browser. Caching an
// opaque response costs the full padded size against the origin's quota and
// cannot be read back to check it, which is a poor trade for artwork.
//
// Bumping VERSION drops every previous cache on activate. It is not needed for
// ordinary updates, since nothing here can serve stale content for more than
// one load, but it is the lever if a bad asset ever gets stuck.

const VERSION = 'v1';
const CACHE = `gameknight-${VERSION}`;

// Enough to open cold with no network. Relative to the worker's scope, so it
// works from a repo subpath as readily as from a domain root.
const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/data.js',
  './js/questions.js',
  './data/games.json',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// Added one at a time rather than with addAll, which rejects the whole install
// if any single entry 404s. A fork that has renamed something should get a
// worker that is merely incomplete, not one that refuses to install.
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.allSettled(SHELL.map((url) => cache.add(url)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    const hit = await cache.match(request);
    if (hit) return hit;
    // An offline navigation to a URL never visited still deserves the app.
    const shell = await cache.match('./index.html');
    return shell || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  const update = fetch(request)
    .then(async (response) => {
      if (response && response.ok) await cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (hit) return hit;
  const fresh = await update;
  return fresh || Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isData = url.pathname.endsWith('/data/games.json');
  const isNavigation = request.mode === 'navigate';
  event.respondWith(isNavigation || isData ? networkFirst(request) : staleWhileRevalidate(request));
});
