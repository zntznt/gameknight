// Structural checks on the wants. Nothing here looks at a shelf, so it holds
// for any fork whatever games they own. Counts against a real collection are a
// separate job: see `npm run audit`, which reports rather than fails, because
// "no party games" is a fact about someone's shelf and not a bug in the code.

import test from 'node:test';
import assert from 'node:assert/strict';
import { QUESTIONS, WEIGHT_BUCKETS } from '../js/questions.js';

// A stand-in game with every field the predicates read. Predicates must cope
// with a game that has nothing interesting on it.
const BARE = {
  id: 1, name: 'Bare', minPlayers: 2, maxPlayers: 4, weight: 0,
  cooperative: false, categories: [], mechanics: [],
};
// And with one that is missing those fields entirely, which BGG data really can
// be: a game with no categories, no mechanics and no player counts.
const EMPTY = { id: 2, name: 'Empty' };

test('question ids are unique', () => {
  const ids = QUESTIONS.map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate question id in ${ids}`);
});

test('every question is shaped the way app.js expects', () => {
  for (const q of QUESTIONS) {
    assert.ok(q.id, 'question needs an id');
    assert.ok(q.title, `${q.id} needs a title`);
    assert.ok(q.kicker, `${q.id} needs a kicker`);
    assert.ok(['single', 'multi'].includes(q.type), `${q.id} has type "${q.type}"`);
    assert.ok(Array.isArray(q.options) && q.options.length >= 2, `${q.id} needs 2+ options`);
  }
});

test('option ids are unique within a question', () => {
  for (const q of QUESTIONS) {
    const ids = q.options.map((o) => o.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate option id in ${q.id}: ${ids}`);
  }
});

test('every option has a label and a match function', () => {
  for (const q of QUESTIONS) {
    for (const o of q.options) {
      assert.ok(o.id, `option in ${q.id} needs an id`);
      assert.ok(o.label, `${q.id}/${o.id} needs a label`);
      assert.equal(typeof o.match, 'function', `${q.id}/${o.id} needs a match fn`);
    }
  }
});

// fitScore counts matches, so a predicate returning undefined or an object
// would still be truthy or falsy by accident and score the wrong way.
test('predicates return a strict boolean, even on sparse data', () => {
  for (const q of QUESTIONS) {
    for (const o of q.options) {
      for (const [what, game] of [['bare', BARE], ['empty', EMPTY]]) {
        assert.equal(
          typeof o.match(game), 'boolean',
          `${q.id}/${o.id} returned ${typeof o.match(game)} for the ${what} game`
        );
      }
    }
  }
});

test('predicates do not throw on a game with no arrays at all', () => {
  for (const q of QUESTIONS) {
    for (const o of q.options) {
      assert.doesNotThrow(() => o.match(EMPTY), `${q.id}/${o.id} threw`);
    }
  }
});

// --- complexity buckets -----------------------------------------------------
// app.js leans on this ordering twice: bandOf finds a game's band by index, and
// weightFit measures the distance between two indices. Both go quietly wrong if
// the list stops ascending or the bands start overlapping.

test('WEIGHT_BUCKETS opens with the "any" escape hatch', () => {
  assert.equal(WEIGHT_BUCKETS[0].key, 'any');
  assert.equal(WEIGHT_BUCKETS[0].hi, 99, '"any" must let every weight through');
});

test('rated buckets ascend and never overlap', () => {
  const rated = WEIGHT_BUCKETS.filter((b) => b.key !== 'any');
  for (let i = 0; i < rated.length; i += 1) {
    assert.ok(rated[i].lo < rated[i].hi, `${rated[i].key} has lo >= hi`);
    if (i > 0) {
      assert.equal(
        rated[i].lo, rated[i - 1].hi,
        `gap or overlap between ${rated[i - 1].key} and ${rated[i].key}`
      );
    }
  }
});

test('every rated weight lands in exactly one bucket', () => {
  const rated = WEIGHT_BUCKETS.filter((b) => b.key !== 'any');
  for (const w of [1, 1.9, 2, 2.4, 2.5, 2.9, 3, 3.9, 4, 4.5, 5]) {
    const hits = rated.filter((b) => w >= b.lo && w < b.hi);
    assert.equal(hits.length, 1, `weight ${w} matched ${hits.length} buckets`);
  }
});

test('bucket keys are unique', () => {
  const keys = WEIGHT_BUCKETS.map((b) => b.key);
  assert.equal(new Set(keys).size, keys.length, `duplicate bucket key in ${keys}`);
});

// --- mood predicates --------------------------------------------------------
// Fixtures, not shelf counts, so these hold for any collection. They pin the
// rule that "fights the game" and "fights each other" are different things.

const tone = QUESTIONS.find((q) => q.id === 'tone');
const mood = (id) => tone.options.find((o) => o.id === id);
const withTags = (patch) => ({ ...BARE, ...patch });

test('a competitive game measuring firing lines is confrontational', () => {
  // Skirmish games are often filed under Miniatures with no Wargame or Fighting
  // category, so the mechanics have to carry it.
  for (const m of ['Line of Sight', 'Measurement Movement']) {
    const g = withTags({ categories: ['Miniatures', 'Science Fiction'], mechanics: [m] });
    assert.equal(mood('cutthroat').match(g), true, `${m} should read as confrontational`);
  }
});

// The guard earns its keep here: Gloomhaven carries Line of Sight, and calling
// a co-op campaign confrontational would be badly wrong.
test('a cooperative game with the same tags is not confrontational', () => {
  const g = withTags({ cooperative: true, categories: ['Fantasy'], mechanics: ['Line of Sight', 'Critical Hits and Failures'] });
  assert.equal(mood('cutthroat').match(g), false, 'you fight the game, not each other');
});

test('a traitor game stays confrontational despite being semi-cooperative', () => {
  const g = withTags({ cooperative: true, mechanics: ['Hidden Roles', 'Player Elimination'] });
  assert.equal(mood('cutthroat').match(g), true);
});

test('a peaceful euro is not dragged in by spatial mechanics', () => {
  const g = withTags({ categories: ['Economic'], mechanics: ['Area Majority / Influence', 'Area Movement'] });
  assert.equal(mood('cutthroat').match(g), false);
});

// Every mood is optional, and a game answering none of them is a real outcome
// rather than a bug. See the note above the tone question in questions.js.
test('a game may legitimately match no mood at all', () => {
  const g = withTags({ categories: ['Adventure'], mechanics: ['Dice Rolling', 'Push Your Luck'] });
  assert.equal(tone.options.some((o) => o.match(g)), false);
});
