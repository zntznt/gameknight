// Shape checks on the baked data. These assert structure, never counts: a fork
// with 12 games and no wargames is not broken, so nothing here cares how many
// of anything there are.
//
// The point is to catch a fetcher that half worked. A parser change once made
// every rank 0 and every poll empty while still writing a file that looked
// perfectly fine, and nothing noticed until the results came out wrong.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../data/games.json', import.meta.url), 'utf8'));
const { games, collections } = data;

test('the file has the top level shape the app reads', () => {
  assert.ok(Array.isArray(games), 'games must be an array');
  assert.ok(Array.isArray(collections), 'collections must be an array');
  assert.ok(data.generatedAt, 'generatedAt is missing');
  assert.ok(data.site, 'site block is missing, so the GitHub badge has no href');
});

test('game ids are unique', () => {
  const ids = games.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, 'a game is baked in twice');
});

test('every game has the fields the cards and sorting need', () => {
  for (const g of games) {
    assert.equal(typeof g.id, 'number', `${g.name} has no numeric id`);
    assert.ok(g.name, `game ${g.id} has no name`);
    assert.equal(typeof g.minPlayers, 'number', `${g.name} has no minPlayers`);
    assert.equal(typeof g.maxPlayers, 'number', `${g.name} has no maxPlayers`);
    assert.equal(typeof g.cooperative, 'boolean', `${g.name} has no cooperative flag`);
    assert.ok(Array.isArray(g.categories), `${g.name} has no categories array`);
    assert.ok(Array.isArray(g.mechanics), `${g.name} has no mechanics array`);
    assert.ok(Array.isArray(g.owners) && g.owners.length, `${g.name} is owned by nobody`);
  }
});

test('player ranges are sane', () => {
  for (const g of games) {
    assert.ok(g.minPlayers >= 1, `${g.name} seats fewer than one player`);
    assert.ok(g.maxPlayers >= g.minPlayers, `${g.name} has max below min`);
  }
});

test('every owner refers to a real shelf', () => {
  const ids = new Set(collections.map((c) => c.id));
  for (const g of games) {
    for (const o of g.owners) {
      assert.ok(ids.has(o), `${g.name} is owned by "${o}", which is not a shelf`);
    }
  }
});

test('shelf ids are unique, since duplicates silently merge', () => {
  const ids = collections.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate shelf id in ${ids}`);
});

test('every shelf has the fields the picker renders', () => {
  for (const c of collections) {
    assert.ok(c.id, 'shelf has no id');
    assert.ok(c.label, `shelf ${c.id} has no label`);
    assert.ok(c.bggUser, `shelf ${c.id} has no bggUser`);
    assert.equal(typeof c.avatar, 'string', `shelf ${c.id} avatar should be a string, "" if unset`);
  }
});

// Missing enrichment must never be a lie. The app treats 0 and undefined as
// "BGG does not know", and ranks those below anything it can place, so a wrong
// TYPE here would be read as real data.
test('optional enrichment is either absent or the right type', () => {
  for (const g of games) {
    for (const f of ['weight', 'rating', 'rank', 'playTime', 'minTime', 'maxTime', 'minAge', 'playsThisMonth', 'pollVotes']) {
      if (g[f] !== undefined) {
        assert.equal(typeof g[f], 'number', `${g.name}.${f} is ${typeof g[f]}, not a number`);
      }
    }
    for (const f of ['bestPlayers', 'recPlayers']) {
      if (g[f] !== undefined) assert.ok(Array.isArray(g[f]), `${g.name}.${f} is not an array`);
    }
  }
});

// The one enrichment assertion that is not shape: if the poll parse breaks
// again it breaks for EVERY game at once, so "not a single game anywhere has a
// suggested player count" is a parser failure rather than a thin shelf.
test('the suggested players poll parsed for at least one game', () => {
  const any = games.some((g) => (g.bestPlayers || []).length || (g.recPlayers || []).length);
  assert.ok(any, 'no game has poll data: the poll parse has probably broken');
});

test('no expansion leaked into the shelf', () => {
  for (const g of games) {
    assert.notEqual(g.type, 'boardgameexpansion', `${g.name} is an expansion`);
  }
});
