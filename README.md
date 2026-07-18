# Gameknight ♞

Point Gameknight at your board game collection (or your whole friend group's
shelves), answer a short flowchart of **wants** — co-op or cutthroat, what
theme you're in the mood for, which mechanisms you're craving — and watch the
list narrow **live** as you go. Only at the end does it ask the boring
**constraints**: how many players, how much brain, how much time. What's left is
what you should actually play tonight.

It's a static site built for **GitHub Pages** — no server, no tracking, works
offline once loaded.

## The trick with BoardGameGeek

BGG's XML API has no CORS support and its collection endpoint is asynchronous
(it makes you poll), so a browser can't call it directly. Gameknight sidesteps
that entirely: a **GitHub Action fetches everything server-side**, enriches each
game with full details (weight, player counts, time, mechanics, categories),
and commits the result as a plain [`data/games.json`](data/games.json). The page
just loads that file — instant, no proxy, no rate limits at runtime.

```
BGG XML API ──(GitHub Action, weekly)──▶ data/games.json ──▶ static page (Pages)
```

## Setup

1. **List your collections.** Edit [`data/collections.config.json`](data/collections.config.json):

   ```json
   {
     "collections": [
       { "id": "alex", "label": "Alex's shelf", "bggUser": "alex_bgg_name" },
       { "id": "sam",  "label": "Sam's shelf",  "bggUser": "sam_bgg_name" }
     ],
     "options": { "own": true, "wishlist": false, "preordered": false }
   }
   ```

   `bggUser` is the BoardGameGeek username. `id` is a short internal key;
   `label` is what shows in the UI.

2. **Bake the data.** In the **Actions** tab, run **Fetch BGG collections**
   (also runs weekly on its own). It writes a fresh `data/games.json` and
   commits it. First run for a large collection can take a couple of minutes —
   BGG queues collection requests and we wait politely.

3. **Publish.** Settings → Pages → Source = **GitHub Actions**. Pushing to
   `main` deploys via [`.github/workflows/pages.yml`](.github/workflows/pages.yml).
   (Or set Source to "Deploy from a branch" → `main` / root and skip that
   workflow.)

Until you run step 2, the app shows bundled **sample data** so you can try the
flow immediately.

## Local development

No build step. Serve the folder over HTTP (ES modules need a real origin):

```bash
npm run serve      # python3 -m http.server 8080  → http://localhost:8080
# or refresh the data locally (needs your usernames in the config):
npm install
npm run fetch
```

## How it's wired

| File | Role |
| --- | --- |
| `index.html` | Shell: a sticky "what remains" panel + a stage the JS renders into. |
| `js/app.js` | Step machine: collections → preferences → constraints → result. |
| `js/questions.js` | **The flowchart.** Data-driven preference questions; edit to reshape it. |
| `js/data.js` | Loads `games.json`, combines collections (union / intersection), applies filters. |
| `scripts/fetch-bgg.mjs` | Server-side BGG fetcher (handles the 202 poll + enrichment). |
| `.github/workflows/fetch-collections.yml` | Runs the fetcher on a schedule / on demand. |
| `data/games.json` | Baked, static game data the page reads. |

### Reshaping the flowchart

Every preference question lives in `js/questions.js` as a plain object with a
`match(game)` predicate per answer. Preferences are ANDed across questions and
ORed within a multi-select. Every question is skippable — a *want* isn't a
*requirement*. Add, remove, or reword questions there; no rebuild needed.

## Notes

- **Union vs. intersection:** with several collections selected, choose "anyone
  owns" (union) or "everyone owns" (intersection — the safe bet if the owner
  might not show up).
- **Plays-well-at-N:** the player-count filter uses BGG's *suggested number of
  players* poll, not just the box range. Pick **Best** (the sweet spot),
  **Recommended** (community says it plays fine), or **Box supports** (anything
  in the min–max range). Games without poll votes fall back to the box range.
  Result cards show a **best N** badge from the same poll.
- **Missing metadata** (e.g. unrated weight, no player poll) never silently
  drops a game from a constraint filter — unknowns pass / fall back to the box.
- Game data © BoardGameGeek; fetched via their XML API for personal use.
