// The service worker's precache list, checked against what the page actually
// asks for.
//
// WHY THIS FILE EXISTS: sw.js lists the shell by hand, and that list rotted
// silently. js/ranking.js was split out of js/app.js months after the worker was
// written, and nobody added it. The result was not an error anywhere: it was a
// cold offline open fetching a module that had never been cached, an import that
// resolved to nothing, and a blank page. Every linter and all 72 other tests
// passed the whole time, because an uncached module is not a syntax problem.
//
// So the list is no longer trusted. These tests walk the real module graph from
// index.html, read the real hrefs out of index.html and manifest.webmanifest,
// and fail if the worker would not have cached something the page needs. The
// next split, rename, or new icon cannot repeat the trick.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// Repo-root-relative, in the './x/y' form the SHELL array uses, so the two sides
// of every assertion are directly comparable.
const asShellPath = (abs) => `./${relative(ROOT, abs).split('\\').join('/')}`;

/* ------------------------------------------------------------------ sw.js -- */
function shellList() {
  const src = read('sw.js');
  const block = src.match(/const SHELL = \[([\s\S]*?)\];/);
  assert.ok(block, 'could not find the SHELL array in sw.js');
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const SHELL = shellList();

/* ------------------------------------------------------- the module graph -- */
// Follows every relative specifier transitively. Bare specifiers are ignored on
// purpose: this project has no build step, so anything not starting with a dot
// is not a file the worker could cache anyway.
function moduleGraph(entries) {
  const seen = new Set();
  const queue = entries.map((e) => resolve(ROOT, e));
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    assert.ok(existsSync(file), `${asShellPath(file)} is imported but does not exist`);
    const src = readFileSync(file, 'utf8');
    // `import x from './y.js'`, `import './y.js'`, and `export … from './y.js'`.
    const specs = [
      ...src.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g),
      ...src.matchAll(/\bimport\s+['"](\.[^'"]+)['"]/g),
    ].map((m) => m[1]);
    for (const s of specs) queue.push(resolve(dirname(file), s));
  }
  return [...seen];
}

// The entry points the browser is actually told about, read from index.html
// rather than hardcoded, so adding a second module tag is covered too.
function scriptEntries() {
  const html = read('index.html');
  return [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]);
}

/* ----------------------------------------------------------------- tests -- */
test('index.html declares at least one module entry point', () => {
  assert.ok(scriptEntries().length > 0);
});

test('every module the page loads is in the service worker shell', () => {
  const graph = moduleGraph(scriptEntries()).map(asShellPath);
  // The regression that motivated this file: js/ranking.js reachable, uncached.
  for (const mod of graph) {
    assert.ok(SHELL.includes(mod), `${mod} is in the module graph but not in sw.js SHELL`);
  }
  // And the walk has to have actually walked, or the loop above passes vacuously
  // the day the specifier regex stops matching.
  assert.ok(graph.length >= 4, `expected the graph to reach several modules, got ${graph.length}`);
  assert.ok(graph.includes('./js/ranking.js'));
});

test('every stylesheet, manifest and icon the page references is in the shell', () => {
  const html = read('index.html');
  const refs = [
    ...[...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="(\.[^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<link[^>]*rel="manifest"[^>]*href="(\.[^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<link[^>]*rel="apple-touch-icon"[^>]*href="(\.[^"]+)"/g)].map((m) => m[1]),
    ...JSON.parse(read('manifest.webmanifest')).icons.map((i) => i.src),
  ];
  assert.ok(refs.length >= 6, `expected several referenced assets, found ${refs.length}`);
  for (const ref of refs) {
    assert.ok(SHELL.includes(ref), `${ref} is referenced by the page but not in sw.js SHELL`);
  }
});

test('every shell entry points at a file that exists', () => {
  for (const entry of SHELL) {
    if (entry === './') continue; // the directory index, served as index.html
    assert.ok(existsSync(join(ROOT, entry)), `sw.js caches ${entry}, which is not in the repo`);
  }
});

test('the shell caches the data the app cannot start without', () => {
  assert.ok(SHELL.includes('./data/games.json'));
  assert.ok(SHELL.includes('./index.html'));
  assert.ok(SHELL.includes('./'));
});
