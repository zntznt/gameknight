// The ordering rules. These were unreachable until ranking.js was split out of
// app.js, so this file is the first time the maths behind a recommendation is
// stated as examples rather than only as prose in a comment.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  constraintPreds, fitScore, answeredWants, weightFit, timeFit, limitFit,
  fitsPlayers, isBestAt, isRecAt, fitTier, anyFilters, sortGames, timeOf,
  UNRATED_WEIGHT_PENALTY, UNKNOWN_TIME_PENALTY, TIME_CAPS,
} from '../js/ranking.js';
import { applyFilters } from '../js/data.js';
import { QUESTIONS } from '../js/questions.js';

const NO_LIMITS = { players: null, playerFit: 'rec', wKey: 'any', maxTime: null, minAge: null };
const limits = (patch) => ({ ...NO_LIMITS, ...patch });

// A game is only ever read through the fields below, so fixtures stay small.
const game = (patch) => ({
  id: 1, name: 'G', minPlayers: 1, maxPlayers: 4, weight: 0, cooperative: false,
  categories: [], mechanics: [], ...patch,
});

const keep = (games, c, skip = null) => applyFilters(games, constraintPreds(c, skip)).map((g) => g.name);

/* ============================================================= limits === */

test('no limits set removes nothing', () => {
  assert.equal(constraintPreds(NO_LIMITS).length, 0);
});

// The rule the whole app rests on. Weight asks what you are WILLING to spend,
// so picking Medium must not throw away the light games you would still play.
test('complexity is a ceiling, not a band', () => {
  const games = [
    game({ name: 'light', weight: 1.5 }),
    game({ name: 'medium', weight: 2.7 }),
    game({ name: 'heavy', weight: 3.5 }),
  ];
  assert.deepEqual(keep(games, limits({ wKey: 'med' })), ['light', 'medium']);
});

test('an unrated weight passes any ceiling rather than being dropped', () => {
  const games = [game({ name: 'unrated', weight: 0 }), game({ name: 'heavy', weight: 3.5 })];
  assert.deepEqual(keep(games, limits({ wKey: 'light' })), ['unrated']);
});

test('length is a ceiling too, and an unknown length passes it', () => {
  const games = [
    game({ name: 'short', playTime: 30 }),
    game({ name: 'long', playTime: 180 }),
    game({ name: 'unknown' }),
  ];
  assert.deepEqual(keep(games, limits({ maxTime: 60 })), ['short', 'unknown']);
});

// The one limit where missing data does NOT pass, and the asymmetry is the
// point: weight and time ask what YOU will spend, so letting an unknown through
// is generosity. Age asks about someone at the table, where "BGG does not know"
// is not a yes.
test('an unknown minimum age fails the age limit', () => {
  const games = [game({ name: 'kids', minAge: 8 }), game({ name: 'adult', minAge: 14 }), game({ name: 'unknown' })];
  assert.deepEqual(keep(games, limits({ minAge: 10 })), ['kids']);
});

test('an unknown age is only excluded once an age is actually chosen', () => {
  const games = [game({ name: 'unknown' })];
  assert.deepEqual(keep(games, limits({})), ['unknown'], 'no age chosen must not drop it');
});

// Guards the asymmetry from being "tidied up" in either direction later.
test('the other limits still pass their unknowns', () => {
  const games = [game({ name: 'no weight', weight: 0 }), game({ name: 'no time' })];
  assert.deepEqual(keep(games, limits({ wKey: 'light', maxTime: 30 })), ['no weight', 'no time']);
});

// This is what lets each chip show its own count: "how many would remain if I
// picked this" has to ignore whatever is currently picked in that same section.
test('skip excludes exactly one limit and leaves the rest', () => {
  const games = [game({ name: 'heavy-short', weight: 3.5, playTime: 30 })];
  const c = limits({ wKey: 'light', maxTime: 60 });
  assert.deepEqual(keep(games, c), [], 'both limits applied drops it');
  assert.deepEqual(keep(games, c, 'weight'), ['heavy-short'], 'skipping weight lets it back');
  assert.deepEqual(keep(games, c, 'time'), [], 'skipping time still drops it on weight');
});

/* ========================================================== player fit === */

test('supported mode uses the box range', () => {
  const g = game({ minPlayers: 2, maxPlayers: 4 });
  assert.equal(fitsPlayers(g, 3, 'supported'), true);
  assert.equal(fitsPlayers(g, 5, 'supported'), false);
});

test('best and recommended use the poll when there are votes', () => {
  const g = game({ minPlayers: 1, maxPlayers: 5, pollVotes: 100, bestPlayers: [4], recPlayers: [3, 4, 5] });
  assert.equal(fitsPlayers(g, 4, 'best'), true);
  assert.equal(fitsPlayers(g, 3, 'best'), false, '3 is recommended but not best');
  assert.equal(fitsPlayers(g, 3, 'rec'), true);
});

// Missing data must never drop a game, here as everywhere else.
test('no poll votes falls back to the box in every mode', () => {
  const g = game({ minPlayers: 2, maxPlayers: 4, pollVotes: 0, bestPlayers: [], recPlayers: [] });
  for (const mode of ['best', 'rec', 'supported']) {
    assert.equal(fitsPlayers(g, 3, mode), true, `mode ${mode}`);
  }
});

test('the 8 chip means eight or more', () => {
  const big = game({ minPlayers: 2, maxPlayers: 12 });
  assert.equal(fitsPlayers(big, 8, 'supported'), true);
  assert.equal(fitsPlayers(game({ minPlayers: 2, maxPlayers: 6 }), 8, 'supported'), false);
  const polled = game({ minPlayers: 2, maxPlayers: 12, pollVotes: 50, bestPlayers: [10] });
  assert.equal(fitsPlayers(polled, 8, 'best'), true, 'best at 10 satisfies "8 or more"');
});

test('isBestAt and isRecAt need poll votes to claim anything', () => {
  const g = game({ pollVotes: 0, bestPlayers: [4], recPlayers: [4] });
  assert.equal(isBestAt(g, 4), false);
  assert.equal(isRecAt(g, 4), false);
});

test('fitTier is flat unless a player count and a poll mode are in play', () => {
  const g = game({ pollVotes: 9, bestPlayers: [4], recPlayers: [3, 4] });
  assert.equal(fitTier(g, limits({})), 0, 'no player count chosen');
  assert.equal(fitTier(g, limits({ players: 4, playerFit: 'supported' })), 0);
  assert.equal(fitTier(g, limits({ players: 4, playerFit: 'best' })), 3, 'best at 4');
  assert.equal(fitTier(g, limits({ players: 3, playerFit: 'best' })), 2, 'only recommended at 3');
});

/* ============================================================ want fit === */

const firstQ = QUESTIONS[0];
const secondQ = QUESTIONS[1];
// Two options inside ONE question, used to prove ticking more of them cannot
// buy more than a single point.
const twoInOne = firstQ.options.slice(0, 2).map((o) => o.id);

test('nothing answered scores zero for everyone', () => {
  assert.equal(fitScore(game({}), {}), 0);
  assert.equal(answeredWants({}), 0);
});

test('each answered question a game satisfies is worth exactly one point', () => {
  const coop = game({ cooperative: true, categories: ['Fantasy'] });
  const one = fitScore(coop, { [firstQ.id]: ['coop'] });
  const two = fitScore(coop, { [firstQ.id]: ['coop'], theme: ['fantasy'] });
  assert.equal(one, 1);
  assert.equal(two, 2);
});

// The reason a 14-option mechanics question cannot drown out a 3-option mood.
test('ticking several options inside one question is still one point', () => {
  const g = game({ cooperative: true, minPlayers: 1 });
  const single = fitScore(g, { [firstQ.id]: [twoInOne[0]] });
  const both = fitScore(g, { [firstQ.id]: twoInOne });
  assert.ok(single <= 1 && both <= 1, `scored ${single} and ${both} for one question`);
});

test('answeredWants counts questions in play, not options ticked', () => {
  assert.equal(answeredWants({ [firstQ.id]: twoInOne }), 1);
  assert.equal(answeredWants({ [firstQ.id]: [twoInOne[0]], [secondQ.id]: [secondQ.options[0].id] }), 2);
  assert.equal(answeredWants({ [firstQ.id]: [] }), 0, 'an empty answer is not an answer');
});

test('anyFilters notices a want as readily as a limit', () => {
  assert.equal(anyFilters({}, NO_LIMITS), false);
  assert.equal(anyFilters({ [firstQ.id]: ['coop'] }, NO_LIMITS), true);
  assert.equal(anyFilters({}, limits({ players: 4 })), true);
  assert.equal(anyFilters({}, limits({ wKey: 'med' })), true);
});

/* =========================================================== limit fit === */

test('no complexity preference costs nothing', () => {
  assert.equal(weightFit(game({ weight: 4.5 }), 'any'), 0);
});

test('complexity decays one notch per band below what you asked for', () => {
  assert.equal(weightFit(game({ weight: 2.7 }), 'med'), 0, 'spot on');
  assert.equal(weightFit(game({ weight: 2.2 }), 'med'), -1, 'one band lighter');
  assert.equal(weightFit(game({ weight: 1.5 }), 'med'), -2, 'two bands lighter');
});

test('an unrated weight ranks below every game that can be placed', () => {
  const worstReal = Math.min(
    weightFit(game({ weight: 1.5 }), 'melt'),
    weightFit(game({ weight: 4.5 }), 'light')
  );
  assert.equal(weightFit(game({ weight: 0 }), 'med'), UNRATED_WEIGHT_PENALTY);
  assert.ok(UNRATED_WEIGHT_PENALTY < worstReal, 'must be worse than any real distance');
});

test('no time cap costs nothing', () => {
  assert.equal(timeFit(game({ playTime: 240 }), null), 0);
});

test('length decays one notch per rung below the cap', () => {
  assert.equal(timeFit(game({ playTime: 100 }), 120), 0, 'a 100 minute game fills a 120 cap');
  assert.equal(timeFit(game({ playTime: 70 }), 120), -1);
  assert.equal(timeFit(game({ playTime: 15 }), 120), -5);
});

test('an unknown length ranks below every game that can be placed', () => {
  const worstReal = timeFit(game({ playTime: 15 }), TIME_CAPS[TIME_CAPS.length - 1]);
  assert.equal(timeFit(game({}), 120), UNKNOWN_TIME_PENALTY);
  assert.ok(UNKNOWN_TIME_PENALTY < worstReal, 'must be worse than any real distance');
});

test('timeOf prefers the headline playing time, then falls back', () => {
  assert.equal(timeOf(game({ playTime: 90, minTime: 30, maxTime: 120 })), 90);
  assert.equal(timeOf(game({ maxTime: 120, minTime: 30 })), 120);
  assert.equal(timeOf(game({ minTime: 30 })), 30);
  assert.equal(timeOf(game({})), 0);
});

test('limitFit sums the two, so both axes count equally', () => {
  const g = game({ weight: 2.2, playTime: 70 });
  assert.equal(limitFit(g, limits({ wKey: 'med', maxTime: 120 })), -2);
});

/* ============================================================ sorting === */

const sortNames = (games, answers, constraints, sortBy) =>
  sortGames(games, { answers, constraints, sortBy }).map((g) => g.name);

test('sortGames returns a copy and leaves the input alone', () => {
  const games = [game({ name: 'a', rating: 1 }), game({ name: 'b', rating: 9 })];
  const before = games.map((g) => g.name);
  const out = sortGames(games, { answers: {}, constraints: NO_LIMITS, sortBy: 'rating' });
  assert.notEqual(out, games);
  assert.deepEqual(games.map((g) => g.name), before, 'input order was mutated');
});

// The headline promise: wants rank, they never remove. A game matching nothing
// still appears, just last.
test('a game matching no wants is ranked last, not dropped', () => {
  const games = [
    game({ name: 'nomatch', rating: 9.9 }),
    game({ name: 'match', cooperative: true, rating: 1 }),
  ];
  const out = sortNames(games, { [firstQ.id]: ['coop'] }, NO_LIMITS, 'rating');
  assert.deepEqual(out, ['match', 'nomatch']);
  assert.equal(out.length, 2, 'nothing was removed');
});

test('fit outranks closeness to the limits', () => {
  // 'far' matches the want but sits two bands light; 'near' is spot on but
  // matches nothing. Fit wins.
  const games = [
    game({ name: 'near', weight: 2.7, rating: 9 }),
    game({ name: 'far', weight: 1.5, cooperative: true, rating: 1 }),
  ];
  assert.deepEqual(
    sortNames(games, { [firstQ.id]: ['coop'] }, limits({ wKey: 'med' }), 'rating'),
    ['far', 'near']
  );
});

test('closeness to the limits outranks the chosen metric', () => {
  const games = [
    game({ name: 'light-but-loved', weight: 1.5, rating: 9.9 }),
    game({ name: 'bang-on', weight: 2.7, rating: 5 }),
  ];
  assert.deepEqual(
    sortNames(games, {}, limits({ wKey: 'med' }), 'rating'),
    ['bang-on', 'light-but-loved']
  );
});

test('the sort section settles ties, and rating always breaks the last one', () => {
  const games = [
    game({ name: 'low', rating: 5, rank: 10, playsThisMonth: 99 }),
    game({ name: 'high', rating: 8, rank: 900, playsThisMonth: 1 }),
  ];
  assert.deepEqual(sortNames(games, {}, NO_LIMITS, 'rating'), ['high', 'low']);
  assert.deepEqual(sortNames(games, {}, NO_LIMITS, 'rank'), ['low', 'high']);
  assert.deepEqual(sortNames(games, {}, NO_LIMITS, 'plays'), ['low', 'high']);
});

test('an unranked game sinks to the bottom when sorting by rank', () => {
  const games = [
    game({ name: 'unranked', rank: 0, rating: 9.9 }),
    game({ name: 'ranked', rank: 5000, rating: 1 }),
  ];
  assert.deepEqual(sortNames(games, {}, NO_LIMITS, 'rank'), ['ranked', 'unranked']);
});

test('a game with no plays logged sorts below one with plays', () => {
  const games = [game({ name: 'quiet', rating: 9 }), game({ name: 'hot', playsThisMonth: 3, rating: 1 })];
  assert.deepEqual(sortNames(games, {}, NO_LIMITS, 'plays'), ['hot', 'quiet']);
});

// The order must be a function of the rules in ranking.js and nothing else.
// Before this was explicit, rating rounded to 1dp left most games tied, and a
// stable sort quietly fell through to the order the fetcher happened to write
// games.json in. That worked, invisibly, until someone changed the fetcher.
test('the order does not depend on the order games arrive in', () => {
  const games = [
    game({ id: 1, name: 'a', rating: 8, rank: 100 }),
    game({ id: 2, name: 'b', rating: 8, rank: 50 }),
    game({ id: 3, name: 'c', rating: 8, rank: 0 }),
    game({ id: 4, name: 'd', rating: 8, rank: 0 }),
  ];
  const opts = { answers: {}, constraints: NO_LIMITS, sortBy: 'rating' };
  const forward = sortGames(games, opts).map((g) => g.name);
  const backward = sortGames([...games].reverse(), opts).map((g) => g.name);
  assert.deepEqual(forward, backward, 'same games, different input order, different result');
  assert.deepEqual(forward, ['b', 'a', 'c', 'd'], 'rank then id settles an identical rating');
});

test('unranked games sort below ranked ones on an identical rating', () => {
  const games = [game({ id: 1, name: 'unranked', rating: 8, rank: 0 }), game({ id: 2, name: 'ranked', rating: 8, rank: 9000 })];
  assert.deepEqual(sortGames(games, { answers: {}, constraints: NO_LIMITS, sortBy: 'rating' }).map((g) => g.name),
    ['ranked', 'unranked']);
});
