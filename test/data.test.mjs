// The pool and filter helpers, against fixtures rather than the real shelf.
// These encode the rule the whole app rests on: limits remove games, wants
// never do.

import test from 'node:test';
import assert from 'node:assert/strict';
import { poolFor, applyFilters, questionPredicate } from '../js/data.js';

const DATA = {
  collections: [{ id: 'a' }, { id: 'b' }],
  games: [
    { id: 1, name: 'Only A', owners: ['a'] },
    { id: 2, name: 'Only B', owners: ['b'] },
    { id: 3, name: 'Both', owners: ['a', 'b'] },
    { id: 4, name: 'Orphan', owners: [] },
    { id: 5, name: 'No owners key' },
  ],
};

const named = (games) => games.map((g) => g.name).sort();

// --- poolFor ----------------------------------------------------------------

test('no shelves selected means no games', () => {
  assert.deepEqual(poolFor(DATA, []), []);
});

test('missing data means no games rather than a crash', () => {
  assert.deepEqual(poolFor(null, ['a']), []);
});

// The union, not the intersection. Picking two shelves should widen the night's
// options, not narrow them to what both people happen to own.
test('selecting shelves unions them, counting a shared game once', () => {
  assert.deepEqual(named(poolFor(DATA, ['a'])), ['Both', 'Only A']);
  assert.deepEqual(named(poolFor(DATA, ['a', 'b'])), ['Both', 'Only A', 'Only B']);
});

test('a game nobody owns is never in the pool', () => {
  const all = named(poolFor(DATA, ['a', 'b']));
  assert.ok(!all.includes('Orphan'));
  assert.ok(!all.includes('No owners key'));
});

// --- applyFilters -----------------------------------------------------------

test('no predicates keeps everything, as a copy', () => {
  const games = DATA.games;
  const out = applyFilters(games, []);
  assert.equal(out.length, games.length);
  assert.notEqual(out, games, 'should not hand back the original array');
});

test('nulls among the predicates are ignored', () => {
  assert.equal(applyFilters(DATA.games, [null, null]).length, DATA.games.length);
});

test('predicates combine with AND', () => {
  const out = applyFilters(DATA.games, [(g) => g.id > 1, (g) => g.id < 4]);
  assert.deepEqual(named(out), ['Both', 'Only B']);
});

// --- questionPredicate ------------------------------------------------------

const Q_MULTI = {
  id: 'm', type: 'multi',
  options: [
    { id: 'lo', match: (g) => g.id <= 2 },
    { id: 'hi', match: (g) => g.id >= 4 },
  ],
};
const Q_SINGLE = { id: 's', type: 'single', options: Q_MULTI.options };

// This null is what makes a want optional. There is no separate "doesn't
// matter" control anywhere in the UI; leaving a question blank is the control.
test('an unanswered question filters nothing', () => {
  assert.equal(questionPredicate(Q_MULTI, []), null);
  assert.equal(questionPredicate(Q_MULTI, undefined), null);
});

test('unknown option ids are treated as unanswered', () => {
  assert.equal(questionPredicate(Q_MULTI, ['nope']), null);
});

test('multi-select ORs the chosen options', () => {
  const pred = questionPredicate(Q_MULTI, ['lo', 'hi']);
  assert.deepEqual(named(DATA.games.filter(pred)), ['No owners key', 'Only A', 'Only B', 'Orphan']);
});

test('single-select uses the one chosen option', () => {
  const pred = questionPredicate(Q_SINGLE, ['hi']);
  assert.deepEqual(named(DATA.games.filter(pred)), ['No owners key', 'Orphan']);
});
