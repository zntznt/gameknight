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
//   navigations and games.json  network first, cache only as a fallback, with a
//                               timeout that is armed only once that fallback
//                               exists, so lie-fi cannot hang the page
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
//
// EVERY FILE IN THE MODULE GRAPH BELONGS HERE. This list is hand-written and it
// silently rotted once already: js/ranking.js was split out of app.js after this
// worker was written, so a cold offline open fetched a module that was not in
// the cache and the page rendered nothing at all. Nothing failed loudly, because
// an uncached module in an offline document is just a dead import.
// test/sw-shell.test.mjs now walks the graph from index.html and fails if this
// list does not cover it, so the next split cannot repeat the trick.
const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/data.js',
  './js/questions.js',
  './js/ranking.js',
  './data/games.json',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
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

// How long a request that already has a cached answer is allowed to hang before
// we serve the cached one instead. Only ever armed when that fallback exists.
const NET_TIMEOUT = 2500;

async function networkFirst(request, event) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);

  const fromNetwork = fetch(request).then(async (response) => {
    if (response && response.ok) await cache.put(request, response.clone());
    return response;
  });

  // Nothing cached: this is a genuine first load, so there is no faster answer
  // to fall back to and the only sane thing is to wait for as long as it takes.
  if (!hit) {
    try {
      return await fromNetwork;
    } catch {
      // An offline navigation to a URL never visited still deserves the app.
      const shell = await cache.match('./index.html');
      return shell || Response.error();
    }
  }

  // Otherwise race it. "Offline" is the easy case, and this worker already
  // handled it; the case it did not handle is lie-fi, where the connection
  // accepts the socket and then never answers, which a phone on a train does
  // far more often than it drops cleanly. fetch() has no timeout of its own, so
  // the page would sit on a blank screen for as long as the radio kept
  // pretending, holding out for a shelf that is already on the disk.
  //
  // waitUntil keeps the update alive past the response. Without it the worker
  // can be terminated the moment the timer wins, and "never stale for more than
  // one load" quietly becomes "stale until the next clean connection".
  if (event) event.waitUntil(fromNetwork.catch(() => null));
  let timer = null;
  try {
    return await Promise.race([
      fromNetwork,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(hit), NET_TIMEOUT);
      }),
    ]);
  } catch {
    return hit;
  } finally {
    clearTimeout(timer);
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
  event.respondWith(
    isNavigation || isData ? networkFirst(request, event) : staleWhileRevalidate(request)
  );
});
