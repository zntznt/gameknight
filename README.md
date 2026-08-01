# Gameknight ♞

**What should we play tonight?**

Point Gameknight at your board game collection, or your whole friend group's
shelves, and it turns "I dunno, what do you fancy?" into one recommendation.
You answer a few **wants** (who is playing together, what mood you are in, what
world, what mechanics, whether everyone plays by the same rules), then set the
**limits** that actually matter (how many players, how much brain, how much
time). It ranks your shelf and names a game.

Live: [www.zntznt.com/gameknight](https://www.zntznt.com/gameknight)

It is a static site on **GitHub Pages**. No server, no tracking, no build step,
and no API calls from your browser.

---

## How the picking works

This is the part worth understanding before you fork it, because it is the whole
design:

**Wants rank. Limits filter.**

* **The wants (the first numbered sections) never remove a game.** Each answered
  question a game satisfies is worth one point, and results sort best fit first.
  Say you want a cooperative fantasy engine builder: a game matching all four
  goes top, a game matching three sits behind it, and a game matching none is
  still there at the bottom. "I fancy something fantasy" is a preference, not
  "delete everything that is not fantasy".
* **The limits (the later sections) do filter, strictly.** If only four of
  you can play and a game seats three, it is gone.
* **Complexity and time are ceilings, not bands.** They ask what you
  are *willing* to spend, so picking Medium keeps the lighter games too, and
  "≤ 120m" keeps the short ones. Both then rank by closeness to what you asked
  for, stepping down one notch per bucket or per time rung, so a medium two hour
  night surfaces medium two hour games ahead of the fillers those ceilings also
  allow. Picking Medium on a 137 game shelf leaves 89 games with the genuinely
  medium ones on top, rather than only the 25 inside that one band.
* **The final section** picks which score settles the order once fit and
  closeness have had their say: BGG rating, BGG rank, or plays logged on BGG this month.

The full ordering is: how many wants a game matches, then how close it sits to
the complexity and length you asked for, then your chosen score.

Every count you see is live. The header shows how many games survive your
limits; each want option shows how many of those games have that quality; each
limit chip shows how many would remain if you picked it. A choice that would
leave nothing dims and turns red, but stays clickable.

Missing BGG data never silently drops a game. An unrated weight passes any
complexity bucket, an unknown play time passes any time cap, and a game with no
player poll falls back to its box player range. It does cost a game in the
ranking though: once you set a complexity or time limit, a game BGG cannot place
on that axis sorts below every game it can, since there is no honest way to call
it a good match for what you asked for.

---

## Deploy your own copy

You need a GitHub account and a BoardGameGeek account. Budget a few days,
because step 2 involves waiting on a human at BGG.

### 1. Fork the repo

Fork it, or use it as a template. Two things to know straight away:

* **`data/games.json` in this repo is not sample data.** It holds a real game
  collection. Your fork will show those games until your own fetch overwrites
  the file in step 5.
* **GitHub Pages on a private repo needs a paid plan.** If you are on a free
  account, keep the fork public. Your BGG token is not affected by this: it
  lives in an encrypted Actions secret, never in the repo. See
  [Keeping your token safe](#keeping-your-token-safe).

### 2. Apply for a BGG API token

Since late 2025 the BGG XML API rejects unauthenticated requests with `401`.
Apply at
[boardgamegeek.com/using_the_xml_api](https://boardgamegeek.com/using_the_xml_api).

It is an application form. You describe what you are building and
wait for approval, so start here rather than leaving it to last. A non
commercial hobby project is exactly what they approve, and there is no fee.

**Two obligations come with approval:**

* **Keep the "Powered by BGG" logo.** BGG requires public facing applications to
  display it. It is already in the header of `index.html`. Do not remove it.
* **Identify your client honestly.** BGG matches API traffic to your registered
  application via the User-Agent, so it must point at your copy rather than
  mine. You do not edit any source for this: set it in the `site` block of
  [`data/collections.config.json`](data/collections.config.json) in step 4, and
  the fetcher builds the User-Agent from it.

### 3. Add the token as a repo secret

**Settings → Secrets and variables → Actions → New repository secret**

| | |
| --- | --- |
| Name | `BGG_TOKEN` |
| Value | the token BGG issued you |

The name must match exactly. Without it the fetch fails with a `401` and a
message telling you so.

### 4. List your shelves

Edit [`data/collections.config.json`](data/collections.config.json):

```json
{
  "site": {
    "repoUrl": "https://github.com/you/your-fork",
    "appUrl": "https://you.github.io/your-fork"
  },
  "collections": [
    { "id": "alex", "label": "Alex", "bggUser": "alex_bgg_name" },
    { "id": "sam",  "label": "Sam",  "bggUser": "sam_bgg_name" }
  ],
  "options": { "own": true, "wishlist": false, "preordered": false }
}
```

**This is the only file you need to edit to make the app yours.** The `site`
block replaces what would otherwise be hardcoded in two places:

* `repoUrl` is where the header's GitHub badge points. The app reads it from
  the baked data at runtime, so the value in `index.html` is only a fallback for
  the moment before your first fetch.
* `appUrl` becomes the User-Agent the fetcher sends to BGG. Leaving mine in
  place would report your API requests as my application.

And the shelves themselves:

* `bggUser` is the BoardGameGeek username, exactly as BGG spells it.
* `label` is what appears on the shelf card. Short names read best.
* `id` is an internal key. **It must be unique.** Two shelves sharing an `id`
  will merge into one and you will not be able to select them separately.
* `options` picks which BGG statuses to pull. Leave `own: true` on its own for a
  "what can we actually play" shelf. These combine with OR and the app cannot
  tell them apart afterwards, so only enable `wishlist` or `preordered` if you
  genuinely want those games mixed in.

### 5. Bake your data

**Actions → Fetch BGG collections → Run workflow**

It reads your config, pulls each collection server side, enriches every game
(weight, player counts, times, categories, mechanics, BGG rank, the suggested
players poll, plays this month, shelf avatars), and commits a fresh
`data/games.json`. It also runs weekly on its own.

A large collection takes a few minutes, since BGG queues collection requests and
the fetcher waits politely between calls.

> If your fork has branch protection on `main`, this step fails: the workflow
> commits the refreshed data directly. Either allow the `github-actions` bot to
> push, or drop the protection.

### 6. Turn on Pages

**Settings → Pages → Build and deployment → Source = Deploy from a branch**,
branch `main`, folder `/ (root)`, Save.

GitHub serves the files as they are. A `.nojekyll` file is included so it does
not try to run Jekyll over them. There is no build step and no deploy workflow,
so every push to `main` republishes automatically, including the weekly data
refresh.

Your site appears at `https://<you>.github.io/<repo>/` within a minute or so.

---

## Installing it as an app

Gameknight is a PWA, so it can be added to a phone's home screen or installed
as a desktop app and then opens in its own window with no browser chrome. There
is nothing to switch on: it works in your fork as soon as Pages is serving over
HTTPS, which it always is.

* **Android and desktop Chrome or Edge** offer an install button in the address
  bar, or under the browser menu.
* **iOS Safari** uses Share, then Add to Home Screen.

Once installed it opens offline too, showing the shelf from the last time you
had signal. Two rules keep that from going stale, both in
[`sw.js`](sw.js):

* Page loads and `games.json` go to the **network first**, falling back to the
  cache only when the network fails. A push to `main` and the weekly data
  refresh reach you on the next load, exactly as they would without the app
  installed.
* Everything else same origin is served from cache and replaced in the
  background, so a stale file is used at most once.

Box art is the exception. Those images live on BGG's servers, so they are left
to the browser and will not appear offline; the monogram tiles stand in for
them, the same as when an image fails to load normally.

**Making it yours.** The name and colours live in
[`manifest.webmanifest`](manifest.webmanifest), and the icons in `icons/` are a
paper knight on the ink background from the header. Replace the PNGs, keeping
the filenames and sizes, and the installed app is branded as yours. Every path
in the manifest is relative, so none of this needs editing for a fork served
from a repo subpath.

---

## Keeping your token safe

Worth stating plainly, since the repo is likely public:

* The token lives **only** in the encrypted Actions secret and the CI job. It is
  never committed and never sent to the browser.
* **Forks of your repo do not inherit your secrets.** Anyone forking you needs
  their own token.
* The fetch workflow runs only on a schedule or manual dispatch, never on
  `pull_request`, so a pull request from a stranger cannot run a job that can
  read your secret.
* The practical trust boundary is **who has write access to your repo**, since a
  collaborator could change a workflow. Only add people you would trust with the
  token itself.
* `.env` is gitignored, so a local token file cannot be committed by accident.

---

## Local development

No build step. Serve the folder over HTTP, since ES modules need a real origin:

```bash
npm run serve      # http://localhost:8080
```

To refresh the data locally instead of via Actions, you need your usernames in
the config and your token in the environment:

```bash
npm install
BGG_TOKEN=your_token_here npm run fetch
```

### Linting

ESLint (JS), Stylelint (CSS) and html-validate (HTML) run on every push and
pull request via [`.github/workflows/lint.yml`](.github/workflows/lint.yml).
All three are dev only: nothing extra reaches the browser.

```bash
npm run lint       # check JS, CSS and HTML
npm run lint:fix   # autofix what is safely fixable in JS and CSS
```

The rules favour catching bugs over enforcing style. The CSS config disables the
cosmetic rules that would fight the stylesheet's compact one line declarations,
the JS config keeps the correctness ones, and the HTML config in
[`.htmlvalidate.json`](.htmlvalidate.json) keeps the structural checks that
matter for a hand maintained page: unclosed tags, duplicate ids, images with no
alt text, elements nested where they are not allowed. Its one cosmetic rule is
set to match the markup rather than rewrite it, since `index.html` closes its
void elements and there is no reason to argue about that.

html-validate has no autofix, so `lint:fix` covers JS and CSS only.

---

## How it is wired

```
BGG XML API  ->  (GitHub Action, weekly)  ->  data/games.json  ->  static page
```

| File | Role |
| --- | --- |
| `index.html` | Page shell: header, the roots the app renders into, font links. |
| `js/app.js` | The whole app: state, the twelve sections, fit scoring, verdict view, quick look sheet, guided scroll. |
| `js/questions.js` | **The wants.** Every question and the `match(game)` predicate behind each answer, plus the complexity buckets. |
| `js/data.js` | Loads `games.json`, builds the pool from the selected shelves, applies predicates. |
| `css/styles.css` | All styling. Fluid, no media queries. |
| `sw.js` | Service worker: makes the page installable and lets it open offline. |
| `manifest.webmanifest` | App name, colours and icons for an installed copy. |
| `icons/` | Install icons. Replace these to brand your fork. |
| `scripts/fetch-bgg.mjs` | Server side BGG fetcher. Handles the async 202 queue, the Bearer token, and enrichment. |
| `.github/workflows/fetch-collections.yml` | Runs the fetcher weekly and on demand, commits the result. |
| `.github/workflows/lint.yml` | Lints on push and pull request. |
| `data/collections.config.json` | Which BGG users to pull. |
| `data/games.json` | The baked data the page reads. Generated, but committed. |

### Reshaping the questions

Every want lives in [`js/questions.js`](js/questions.js) as a plain object with
a `match(game)` predicate per answer. Add, remove or reword them freely and
reload. No build step.

Matching on categories and mechanics is case insensitive substring, so a needle
like `Draft` catches "Card Drafting", "Open Drafting" and "Action Drafting".
That is convenient but blunt, so check your counts after editing: an option that
reads `0` against a shelf you know contains such games usually means the needle
does not match BGG's exact wording.

Because wants score rather than filter, predicates can overlap happily. A game
can be both thinky and confrontational without anything breaking.

---

## Notes and limits

* **The data is baked weekly, not live.**
* **Plays this month** counts plays logged on BGG by everyone, not by you. It is
  a "what is hot right now" signal, matching the other two sorts which are also
  global BGG metrics.
* **Player fit** uses BGG's suggested players poll rather than just the box.
  Pick Best, Recommended, or Box supports. Games with no poll votes fall back to
  the box range in all three modes.
* **Expansions are excluded** from collections, since you cannot sit down and
  play one on its own.
* Thumbnails come from BGG's CDN at up to 200x150. Ones that fail to load fall
  back to a monogram tile.
* Game data is © BoardGameGeek, fetched via their XML API under a non commercial
  registration.

## License

MIT. See [LICENSE](LICENSE).
