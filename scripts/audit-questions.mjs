// Prints how each want option performs against the baked shelf.
//
//   npm run audit
//
// This REPORTS, it never fails. Every number here depends on which games you
// own, so an option reading 0 is a fact about your collection rather than a bug
// in the code, and CI has no business deciding which is which. The test suite
// covers what is true for everybody; this covers what is true for you.
//
// What to look for, and what each usually means:
//
//   0 or a very low count   The needle probably does not match BGG's exact
//                           wording. Matching is case-insensitive substring, so
//                           'Draft' catches "Card Drafting" and "Open Drafting",
//                           but 'Trick Taking' will not catch "Trick-taking".
//                           Check a game you KNOW should match before assuming
//                           you simply do not own any.
//   above about half        The option gives half your shelf a point, so
//                           choosing it barely reorders anything. Usually it is
//                           lumping several different wants together and wants
//                           splitting. Single-choice questions are the
//                           exception: those partition the shelf, so one large
//                           answer there is normal.
//   coverage below 100%     Games no option in that question can reach. Read
//                           this last, and do not treat it as a score to
//                           maximise. A game matching nothing simply scores
//                           nothing on that question: it is never removed, and
//                           it still competes on every other one. Some games
//                           honestly have no answer, and widening an option
//                           until they do is how an option stops meaning
//                           anything. Chase a needle that looks WRONG, not a
//                           coverage line that is short.

import { readFileSync } from 'node:fs';
import { QUESTIONS } from '../js/questions.js';

const data = JSON.parse(readFileSync(new URL('../data/games.json', import.meta.url), 'utf8'));
const games = data.games;
const N = games.length;
const pct = (n) => `${Math.round((n / N) * 100)}%`;
const bar = (n) => '#'.repeat(Math.round((n / N) * 24)).padEnd(24, '.');

const DEAD_AT = 5; // an option this small cannot meaningfully rank anything
const BROAD_AT = 0.5; // half the shelf

console.log(`\nShelf: ${N} games from ${data.collections.length} collections (baked ${data.generatedAt})\n`);

const notes = [];

for (const q of QUESTIONS) {
  console.log(`${q.title}   [${q.type}]`);
  for (const o of q.options) {
    const n = games.filter(o.match).length;
    const flags = [];
    if (n <= DEAD_AT) flags.push(n === 0 ? 'NOTHING MATCHES' : 'very narrow');
    // A single-choice question partitions the shelf, so a big answer there is
    // structural rather than a fault. Only flag breadth on multi-selects, where
    // options are meant to be distinct cravings.
    if (q.type === 'multi' && n / N > BROAD_AT) flags.push('very broad');
    if (flags.length) notes.push(`${q.id}/${o.id} (${n}, ${pct(n)}): ${flags.join(', ')}`);
    console.log(
      `  ${o.label.padEnd(26)} ${String(n).padStart(4)} ${pct(n).padStart(5)}  ${bar(n)}` +
      (flags.length ? `  <- ${flags.join(', ')}` : '')
    );
  }
  const covered = games.filter((g) => q.options.some((o) => o.match(g)));
  console.log(`  ${'coverage'.padEnd(26)} ${String(covered.length).padStart(4)} ${pct(covered.length).padStart(5)}`);
  if (covered.length < N) {
    const missed = games.filter((g) => !q.options.some((o) => o.match(g))).map((g) => g.name);
    console.log(`  reachable by nothing here: ${missed.join(', ')}`);
  }
  console.log('');
}

if (notes.length) {
  console.log('Worth a look:');
  for (const n of notes) console.log(`  ${n}`);
  console.log('\nNone of these fail the build. See the notes at the top of this script.\n');
} else {
  console.log('Every option carries its weight against this shelf.\n');
}
