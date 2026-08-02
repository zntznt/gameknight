// ranking.js. How a shelf is narrowed and then ordered.
//
// Everything here is a pure function of the arguments it is handed. It was all
// inside app.js reading a module-level `state` object, which made the ordering
// rules the one part of the app no test could reach: app.js calls boot() at
// import, so merely importing it needs a browser.
//
// app.js keeps one-line wrappers that supply `state`, so nothing at the call
// sites changed. The point of the split is that the rules can now be stated as
// examples rather than only as prose.
//
// THE MODEL, in one line: limits remove games, wants only reorder them.
//
//   constraintPreds   the limits. These are the only thing that drops a game.
//   fitScore          how many answered wants a game satisfies. Never drops.
//   weightFit/timeFit how close a survivor sits to the complexity and length
//                     you asked for, as a penalty in notches, 0 being spot on.
//   sortGames         fit first, then that closeness, then your chosen metric.

import { QUESTIONS, WEIGHT_BUCKETS } from './questions.js';
import { questionPredicate } from './data.js';

/* ---------------------------------------------------------------- time -- */
// The caps the time limit offers, ascending. Shared by the chips and by
// timeFit so the two cannot drift apart.
export const TIME_CAPS = [15, 30, 45, 60, 90, 120, 180];

// A game's length, preferring the headline playing time.
export const timeOf = (g) => g.playTime || g.maxTime || g.minTime || 0;

/* -------------------------------------------------------------- weight -- */
export const bucketFor = (key) => WEIGHT_BUCKETS.find((b) => b.key === key) || WEIGHT_BUCKETS[0];

// Buckets excluding "Any", in ascending order, so a game's band is its index.
export const RATED_BUCKETS = WEIGHT_BUCKETS.filter((b) => b.key !== 'any');
const bandOf = (g) => RATED_BUCKETS.findIndex((b) => g.weight >= b.lo && g.weight < b.hi);

// An unrated weight still passes the ceiling, but ranks below every game we can
// actually place, since we cannot claim it is the complexity you asked for.
// Worse than the largest real band distance.
export const UNRATED_WEIGHT_PENALTY = -RATED_BUCKETS.length;

// Same rule for an unknown length. Worst real distance is TIME_CAPS.length - 1,
// so this is always worse.
export const UNKNOWN_TIME_PENALTY = -TIME_CAPS.length;

/* --------------------------------------------------------- player fit -- */
// 'supported' = the box min–max. 'rec'/'best' = BGG's suggested-players poll.
// A game with no poll votes falls back to the box range in all three modes.
// The "8" chip means "8 or more".
export function fitsPlayers(g, n, mode) {
  const atLeast = n >= 8;
  const inBox = atLeast ? g.maxPlayers >= 8 : g.minPlayers <= n && g.maxPlayers >= n;
  if (mode === 'supported') return inBox;
  const arr = mode === 'best' ? g.bestPlayers : g.recPlayers;
  if (!g.pollVotes || !Array.isArray(arr) || !arr.length) return inBox;
  return atLeast ? arr.some((c) => c >= 8) : arr.includes(n);
}

export function isBestAt(g, n) {
  if (!n || !g.pollVotes || !Array.isArray(g.bestPlayers)) return false;
  return n >= 8 ? g.bestPlayers.some((c) => c >= 8) : g.bestPlayers.includes(n);
}

export function isRecAt(g, n) {
  if (!n || !g.pollVotes || !Array.isArray(g.recPlayers)) return false;
  return n >= 8 ? g.recPlayers.some((c) => c >= 8) : g.recPlayers.includes(n);
}

// Only used to tint the shortlist tag. Ordering comes from the sort section.
export function fitTier(g, c) {
  if (!c.players || c.playerFit === 'supported') return 0;
  const best = isBestAt(g, c.players);
  const rec = isRecAt(g, c.players);
  if (c.playerFit === 'best') return best ? 3 : rec ? 2 : 1;
  return rec ? 3 : best ? 2 : 1;
}

/* ---------------------------------------------------------------- age -- */
// Age is the one limit where "BGG does not know" must not mean "yes".
//
// Everywhere else, missing data passing is generosity toward the user's own
// flexibility: weight and time ask what YOU are willing to spend, so letting an
// unplaceable game through and sinking it in the ranking costs nothing worse
// than a game that turns out heavier or longer than you fancied, and the card
// shows you the numbers either way.
//
// This question asks about someone else at the table. Passing an unknown here
// is not generosity, it is a claim about a child's game that we have no basis
// for, and the card cannot show a reassuring number because there is none.
// Applied to this shelf the old rule was not a near miss: asking for 6+ left
// seven games, every one of them missing its age, and the answer it named was a
// Netrunner fan expansion.
//
// So an unknown age fails an age limit. Nothing else changes: with no age
// chosen this is never consulted, and the other limits keep passing their
// unknowns exactly as before.
export const fitsAge = (g, minAge) => Boolean(g.minAge) && g.minAge <= minAge;

/* ------------------------------------------------------------- limits -- */
// The only thing that removes a game. `skip` excludes one limit so its chips
// can each show their own count.
export function constraintPreds(c, skip = null) {
  const preds = [];
  const bk = bucketFor(c.wKey);
  if (c.players && skip !== 'players') preds.push((g) => fitsPlayers(g, c.players, c.playerFit));
  // Missing metadata passes on the axes that describe YOUR tolerance: an
  // unrated weight and an unknown length both survive and are sunk in the
  // ranking instead. Age is the exception, for the reason given above it.
  //
  // Weight is a CEILING, not a band. The question asks how much brain you are
  // willing to spend, so anything heavier is out while anything lighter is
  // still perfectly playable. Preferring the weight you actually asked for is
  // handled by weightFit in the ranking, not by throwing lighter games away.
  if (skip !== 'weight' && bk.hi < 99) {
    preds.push((g) => !g.weight || g.weight < bk.hi);
  }
  if (c.maxTime && skip !== 'time') {
    preds.push((g) => {
      const t = timeOf(g);
      return !t || t <= c.maxTime;
    });
  }
  if (c.minAge && skip !== 'age') preds.push((g) => fitsAge(g, c.minAge));
  return preds;
}

/* ----------------------------------------------------------- want fit -- */
// How many of the answered wants this game satisfies. Each answered question is
// worth one point regardless of how many options are ticked inside it, so a
// 10-option theme question cannot outweigh the single-choice mood question.
export function fitScore(g, answers) {
  let score = 0;
  for (const q of QUESTIONS) {
    const pred = questionPredicate(q, answers[q.id]);
    if (pred && pred(g)) score += 1;
  }
  return score;
}

// How many wants are in play at all, so fit can be shown as "2 of 3".
export function answeredWants(answers) {
  return QUESTIONS.filter((q) => (answers[q.id] || []).length > 0).length;
}

/* ---------------------------------------------------------- limit fit -- */
// Complexity and time are both ceilings: they ask what you are WILLING to
// spend, so lighter and shorter games survive the filter. These score how close
// a survivor sits to what you actually asked for, in notches, where 0 is spot
// on and every step below costs one. Missing data survives the filter but takes
// a single notch, since we cannot confirm it is what you wanted and it should
// not outrank something we can confirm.

// -Math.abs(0) is negative zero, which would make a spot-on match return -0
// while this file promises 0. Nothing downstream can tell the difference, since
// the only use is subtraction, but a function should not contradict its own
// documentation.
const notches = (d) => (d === 0 ? 0 : -Math.abs(d));

export function weightFit(g, key) {
  if (key === 'any') return 0; // no preference expressed
  const target = RATED_BUCKETS.findIndex((b) => b.key === key);
  if (target < 0) return 0;
  if (!g.weight) return UNRATED_WEIGHT_PENALTY;
  const band = bandOf(g);
  return band < 0 ? UNRATED_WEIGHT_PENALTY : notches(target - band);
}

// A game's rung is the shortest offered cap it still fits inside, so a 50 minute
// game and a 60 minute one share the "60" rung and both read as a good use of an
// hour, while a 15 minute filler sits three rungs down.
export function timeFit(g, cap) {
  if (!cap) return 0;
  const target = TIME_CAPS.indexOf(cap);
  if (target < 0) return 0;
  const t = timeOf(g);
  if (!t) return UNKNOWN_TIME_PENALTY;
  const rung = TIME_CAPS.findIndex((c) => t <= c);
  return rung < 0 ? UNKNOWN_TIME_PENALTY : notches(target - rung);
}

// Summed rather than tiered: both measure the same thing in the same unit, and
// neither is obviously more important than the other.
export const limitFit = (g, c) => weightFit(g, c.wKey) + timeFit(g, c.maxTime);

export function anyFilters(answers, c) {
  return (
    QUESTIONS.some((q) => (answers[q.id] || []).length > 0) ||
    !!c.players || !!c.maxTime || !!c.minAge || c.wKey !== 'any'
  );
}

/* ------------------------------------------------------------ sorting -- */
// Exported: the sort tag in app.js shows this number as well as sorting by it.
export const playsThisMonth = (g) => g.playsThisMonth || 0;

// Best fit first, then the metric chosen in the sort section settles the order
// among games that fit equally well.
export function sortGames(games, { answers, constraints, sortBy }) {
  return games.slice().sort((a, b) => {
    const fit = fitScore(b, answers) - fitScore(a, answers);
    if (fit) return fit;
    // Then closeness to the complexity and length you asked for, so a medium
    // two hour night surfaces medium two hour games ahead of the light fillers
    // those ceilings also allow.
    const lim = limitFit(b, constraints) - limitFit(a, constraints);
    if (lim) return lim;
    if (sortBy === 'plays') {
      const d = playsThisMonth(b) - playsThisMonth(a);
      if (d) return d;
    }
    if (sortBy === 'rank') {
      const ra = a.rank > 0 ? a.rank : Infinity;
      const rb = b.rank > 0 ? b.rank : Infinity;
      if (ra !== rb) return ra - rb; // unranked sinks to the bottom
    }
    const byRating = (b.rating || 0) - (a.rating || 0);
    if (byRating) return byRating;
    // Explicit last tier, and today it changes nothing: the fetcher rounds
    // rating to one decimal, so 128 of 137 games share a rating with something,
    // and it also writes games.json in ascending rank order. A stable sort was
    // therefore already falling through to rank via input order. That was
    // invisible, untested, and would have silently reshuffled the shortlist the
    // day anyone changed how the file is written. Verified behaviour preserving
    // across all 105 scenarios (3 sort modes x 35 single wants).
    const ra = a.rank > 0 ? a.rank : Infinity;
    const rb = b.rank > 0 ? b.rank : Infinity;
    if (ra !== rb) return ra - rb;
    // Rank alone still left 40 of those 105 scenarios decided by input order,
    // because every unranked game ties with every other at Infinity. Id closes
    // it: the order is now fully determined by the rules stated here and by
    // nothing else. It reorders only the tail among unranked games and changes
    // no verdict at all (0 of 105).
    return a.id - b.id;
  });
}
