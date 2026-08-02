// ESLint flat config.
//
// Two environments live in this repo:
//   js/       browser ES modules, loaded directly by index.html (no build step)
//   scripts/  Node, run by the GitHub Action that bakes data/games.json
//
// Lint-only tooling: nothing here is shipped to the browser.
//
//   npm run lint        check
//   npm run lint:fix    check and autofix what's safely fixable

import js from '@eslint/js';

const browserGlobals = {
  document: 'readonly',
  window: 'readonly',
  location: 'readonly',
  navigator: 'readonly',
  fetch: 'readonly',
  console: 'readonly',
  Image: 'readonly',
  requestAnimationFrame: 'readonly',
  IntersectionObserver: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
};

// sw.js runs in the ServiceWorkerGlobalScope, not the page: no document, no
// window, and `self` in place of both.
const workerGlobals = {
  self: 'readonly',
  caches: 'readonly',
  clients: 'readonly',
  fetch: 'readonly',
  Response: 'readonly',
  URL: 'readonly',
  console: 'readonly',
};

const nodeGlobals = {
  process: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  setTimeout: 'readonly',
  URL: 'readonly',
};

const sharedRules = {
  // --- correctness: rules that catch real bugs -------------------------------
  'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_' }],
  'no-undef': 'error',
  'no-constant-binary-expression': 'error', // e.g. `!x || y === 0` mistakes
  'array-callback-return': 'error', // a .map/.filter that forgets to return
  'no-self-compare': 'error',
  'no-unmodified-loop-condition': 'error',
  'no-unreachable-loop': 'error',
  'no-promise-executor-return': 'error',
  'require-atomic-updates': 'error',
  'no-template-curly-in-string': 'error', // '${x}' in a plain quoted string
  'no-throw-literal': 'error',
  'consistent-return': 'error',
  radix: 'error',
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-implicit-coercion': ['error', { boolean: false }],
  'no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
  'no-shadow': 'error',
  'no-return-assign': ['error', 'except-parens'],
  'no-param-reassign': 'error',

  // --- modern-JS hygiene -----------------------------------------------------
  'no-var': 'error',
  'prefer-const': 'error',
  'prefer-arrow-callback': 'error',
  'object-shorthand': ['error', 'properties'],
  'no-else-return': ['error', { allowElseIf: true }],
  'no-lonely-if': 'error',
  'default-case-last': 'error',
  'no-console': 'off', // the fetcher's progress logging is the point
};

export default [
  {
    ignores: ['node_modules/**', 'data/**', 'package-lock.json'],
  },
  js.configs.recommended,
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: browserGlobals,
    },
    rules: sharedRules,
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: nodeGlobals,
    },
    rules: sharedRules,
  },
  {
    // node:test suite. Same runtime as scripts/, so the same globals.
    files: ['test/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: nodeGlobals,
    },
    rules: sharedRules,
  },
  {
    files: ['sw.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: workerGlobals,
    },
    rules: sharedRules,
  },
  {
    files: ['eslint.config.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    rules: sharedRules,
  },
];
