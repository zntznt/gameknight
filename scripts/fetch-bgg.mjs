// fetch-bgg.mjs
// Server-side BGG fetcher. Runs in CI (no CORS), handles the async 202 queue,
// enriches every owned game with full details, and writes data/games.json.
//
//   node scripts/fetch-bgg.mjs
//
// Reads data/collections.config.json for the usernames to pull.

import { readFile, writeFile } from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';

const API = 'https://boardgamegeek.com/xmlapi2';
const CONFIG_PATH = new URL('../data/collections.config.json', import.meta.url);
const OUT_PATH = new URL('../data/games.json', import.meta.url);
const CHUNK = 20; // ids per `thing` request
const UA = 'Gameknight/0.1 (+https://github.com/) collection baker';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  isArray: (name) => ['item', 'link', 'name', 'rank'].includes(name),
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toArr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// Fetch with retry, honoring BGG's 202 "still queuing, try again" response.
async function bggGet(url, { tries = 8 } = {}) {
  for (let i = 0; i < tries; i++) {
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': UA } });
    } catch (e) {
      await sleep(2000 * (i + 1));
      continue;
    }
    if (res.status === 200) return res.text();
    if (res.status === 202) {
      // collection is being prepared server-side; wait and retry
      await sleep(3000 + 2000 * i);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      await sleep(3000 * (i + 1));
      continue;
    }
    throw new Error(`BGG ${res.status} for ${url}`);
  }
  throw new Error(`BGG kept us waiting too long: ${url}`);
}

async function fetchCollectionIds(username, options) {
  const flags = [];
  if (options.own !== false) flags.push('own=1');
  if (options.wishlist) flags.push('wishlist=1');
  if (options.preordered) flags.push('preordered=1');
  const url = `${API}/collection?username=${encodeURIComponent(username)}&brief=1&${flags.join('&')}`;
  console.log(`  → collection for ${username}`);
  const xml = await bggGet(url);
  const parsed = parser.parse(xml);
  const items = toArr(parsed?.items?.item);
  return items.map((it) => String(it.objectid)).filter(Boolean);
}

async function fetchThings(ids) {
  const url = `${API}/thing?id=${ids.join(',')}&stats=1&type=boardgame,boardgameexpansion`;
  const xml = await bggGet(url);
  const parsed = parser.parse(xml);
  return toArr(parsed?.items?.item).map(parseThing);
}

function parseThing(it) {
  const names = toArr(it.name);
  const primary = names.find((n) => n.type === 'primary') || names[0] || {};
  const links = toArr(it.link);
  const cats = links.filter((l) => l.type === 'boardgamecategory').map((l) => l.value);
  const mechs = links.filter((l) => l.type === 'boardgamemechanic').map((l) => l.value);
  const ratings = it.statistics?.ratings || {};
  const ranks = toArr(ratings.ranks?.rank);
  const overall = ranks.find((r) => r.name === 'boardgame');
  return {
    id: num(it.id),
    name: primary.value || 'Unknown',
    year: num(it.yearpublished?.value),
    thumbnail: it.thumbnail || '',
    image: it.image || '',
    minPlayers: num(it.minplayers?.value),
    maxPlayers: num(it.maxplayers?.value),
    minTime: num(it.minplaytime?.value),
    maxTime: num(it.maxplaytime?.value),
    playTime: num(it.playingtime?.value),
    minAge: num(it.minage?.value),
    weight: Math.round(num(ratings.averageweight?.value) * 10) / 10,
    rating: Math.round(num(ratings.average?.value) * 10) / 10,
    rank: overall && overall.value !== 'Not Ranked' ? num(overall.value) : 0,
    cooperative: mechs.some((m) => /cooperative/i.test(m)),
    categories: cats,
    mechanics: mechs,
  };
}

async function main() {
  const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
  const collections = (config.collections || []).filter((c) => c.bggUser);
  const options = config.options || { own: true };
  if (!collections.length) {
    console.error('No collections with a bggUser in collections.config.json — nothing to do.');
    process.exit(1);
  }

  // 1) gather owned ids per collection
  const ownersById = new Map(); // gameId -> Set(collectionId)
  for (const c of collections) {
    const ids = await fetchCollectionIds(c.bggUser, options);
    console.log(`    ${c.bggUser}: ${ids.length} items`);
    for (const id of ids) {
      if (!ownersById.has(id)) ownersById.set(id, new Set());
      ownersById.get(id).add(c.id);
    }
    await sleep(2000); // be polite between users
  }

  const allIds = [...ownersById.keys()];
  console.log(`  ${allIds.length} unique games to enrich`);

  // 2) enrich in chunks
  const details = new Map();
  for (let i = 0; i < allIds.length; i += CHUNK) {
    const chunk = allIds.slice(i, i + CHUNK);
    console.log(`  → thing ${i + 1}–${i + chunk.length} of ${allIds.length}`);
    const things = await fetchThings(chunk);
    for (const t of things) details.set(String(t.id), t);
    await sleep(2000);
  }

  // 3) stitch owners back on and sort by rank
  const games = allIds
    .map((id) => {
      const d = details.get(id);
      if (!d) return null;
      return { ...d, owners: [...ownersById.get(id)].sort() };
    })
    .filter(Boolean)
    .sort((a, b) => (a.rank || 99999) - (b.rank || 99999) || (b.rating || 0) - (a.rating || 0));

  const out = {
    generatedAt: new Date().toISOString(),
    collections: collections.map(({ id, label, bggUser }) => ({ id, label, bggUser })),
    games,
  };
  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log(`✓ Wrote ${games.length} games to data/games.json`);
}

main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
