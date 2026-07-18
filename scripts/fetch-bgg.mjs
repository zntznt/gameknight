// fetch-bgg.mjs
// Server-side BGG fetcher. Runs in CI (no CORS), handles the async 202 queue,
// enriches every owned game with full details, and writes data/games.json.
//
//   BGG_TOKEN=<your token> node scripts/fetch-bgg.mjs
//
// Reads data/collections.config.json for the usernames to pull.
//
// Since late 2025 the BGG XML API requires a Bearer token (register at
// https://boardgamegeek.com/using_the_xml_api). Provide it via the BGG_TOKEN
// environment variable — in CI, store it as the repo secret BGG_TOKEN.

import { readFile, writeFile } from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';

const API = 'https://boardgamegeek.com/xmlapi2';
const CONFIG_PATH = new URL('../data/collections.config.json', import.meta.url);
const OUT_PATH = new URL('../data/games.json', import.meta.url);
const CHUNK = 20; // ids per `thing` request
// Identifies this client to BGG. Keep it pointing at the real repo so BGG can
// match API traffic to the registered application.
const UA = 'Gameknight/0.1 (+https://github.com/zntznt/gameknight) collection baker';
const TOKEN = (process.env.BGG_TOKEN || process.env.BGG_API_TOKEN || '').trim();

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  isArray: (name) => ['item', 'link', 'name', 'rank', 'poll', 'results', 'result'].includes(name),
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
      const headers = { 'User-Agent': UA };
      if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;
      res = await fetch(url, { headers });
    } catch (e) {
      await sleep(2000 * (i + 1));
      continue;
    }
    if (res.status === 200) {
      const body = await res.text();
      // Some collection responses come back 200 with a "still processing" message
      // instead of 202. Treat that as a retry too.
      if (/try again later|being (re)?processed|please try again/i.test(body)) {
        await sleep(3000 + 2000 * i);
        continue;
      }
      return body;
    }
    if (res.status === 202) {
      // collection is being prepared server-side; wait and retry
      await sleep(3000 + 2000 * i);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      await sleep(3000 * (i + 1));
      continue;
    }
    if (res.status === 401) {
      throw new Error(
        TOKEN
          ? 'BGG returned 401 — the BGG_TOKEN is invalid or expired. Re-check it at https://boardgamegeek.com/using_the_xml_api'
          : 'BGG returned 401 — the XML API now requires a Bearer token. Register at https://boardgamegeek.com/using_the_xml_api and pass it as BGG_TOKEN (repo secret in CI).'
      );
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
  // Safety net: with no status filter, BGG returns the user's ENTIRE collection
  // (rated, commented, previously owned, wishlisted…). Fall back to owned-only.
  if (flags.length === 0) {
    console.warn(`    ⚠ No status filter set for "${username}" — defaulting to own=1.`);
    flags.push('own=1');
  }
  // excludesubtype drops expansions — you can't sit down and play an expansion.
  const url = `${API}/collection?username=${encodeURIComponent(username)}&brief=1&excludesubtype=boardgameexpansion&${flags.join('&')}`;
  console.log(`  → collection for ${username}`);
  const xml = await bggGet(url);
  const parsed = parser.parse(xml);
  if (parsed?.errors) {
    const msg = toArr(parsed.errors.error).map((e) => e.message).join('; ');
    console.warn(`    ⚠ BGG rejected "${username}": ${msg || 'unknown error'} — skipping.`);
    return [];
  }
  const items = toArr(parsed?.items?.item);
  if (items.length === 0) {
    console.warn(`    ⚠ "${username}" returned 0 games (private collection, typo, or empty shelf?).`);
  }
  return items.map((it) => String(it.objectid)).filter(Boolean);
}

async function fetchThings(ids) {
  const url = `${API}/thing?id=${ids.join(',')}&stats=1&type=boardgame,boardgameexpansion`;
  const xml = await bggGet(url);
  const parsed = parser.parse(xml);
  return toArr(parsed?.items?.item).map(parseThing);
}

// Parse the "suggested_numplayers" community poll into best/recommended counts.
//   • Recommended at N  ⇔  Best + Recommended votes > Not-Recommended votes
//   • Best at N         ⇔  Best votes lead the other two
// (Best ⊆ Recommended by construction.) "N+" overflow entries are skipped —
// they mean "more than the box max", which our exact-N filter doesn't use.
function parsePlayerPoll(it) {
  const poll = toArr(it.poll).find((p) => p.name === 'suggested_numplayers');
  const best = [];
  const rec = [];
  const votes = poll ? num(poll.totalvotes) : 0;
  if (poll) {
    for (const r of toArr(poll.results)) {
      const raw = String(r.numplayers ?? '');
      if (raw.includes('+')) continue;
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n)) continue;
      const by = {};
      for (const res of toArr(r.result)) by[res.value] = num(res.numvotes);
      const b = by['Best'] || 0;
      const rc = by['Recommended'] || 0;
      const nr = by['Not Recommended'] || 0;
      if (b + rc + nr === 0) continue;
      if (b + rc > nr) rec.push(n);
      if (b > rc && b > nr) best.push(n);
    }
  }
  return { bestPlayers: best, recPlayers: rec, pollVotes: votes };
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
  const poll = parsePlayerPoll(it);
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
    bestPlayers: poll.bestPlayers,
    recPlayers: poll.recPlayers,
    pollVotes: poll.pollVotes,
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
  if (!TOKEN) {
    console.warn(
      '⚠ No BGG_TOKEN set. The BGG XML API has required a Bearer token since late 2025,\n' +
        '  so this will almost certainly 401. Register at https://boardgamegeek.com/using_the_xml_api\n' +
        '  and pass it as BGG_TOKEN (locally: `BGG_TOKEN=... npm run fetch`; in CI: repo secret BGG_TOKEN).'
    );
  } else {
    console.log('✓ Using BGG_TOKEN for XML API authorization.');
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

  const collectionsOut = collections.map(({ id, label, bggUser }) => ({ id, label, bggUser }));

  // Skip the write (and therefore the commit) if only the timestamp would change.
  let unchanged = false;
  try {
    const prev = JSON.parse(await readFile(OUT_PATH, 'utf8'));
    unchanged =
      !prev.sample &&
      JSON.stringify(prev.games) === JSON.stringify(games) &&
      JSON.stringify(prev.collections) === JSON.stringify(collectionsOut);
  } catch {
    /* no previous file — treat as changed */
  }
  if (unchanged) {
    console.log('✓ No changes since last run — leaving data/games.json untouched.');
    return;
  }

  const out = {
    generatedAt: new Date().toISOString(),
    collections: collectionsOut,
    games,
  };
  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log(`✓ Wrote ${games.length} games to data/games.json`);
}

main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
