# TCGTracker on Cloudflare Workers (free-tier deploy)

This is a from-scratch backend rewrite of `../server` (the Node/Express
version), built to run on Cloudflare Workers' genuinely-free plan instead of
a usage-metered host like Railway. The frontend (`../public` — `index.html`,
`lorcana.html`, `pokemon.html`, `pwa-boot.js`, `sw.js`, images, etc.) is
**completely untouched** — this only replaces what serves it and what polls
retailers in the background.

## Why this isn't a 1:1 port — read this first

Cloudflare's free plan caps every Worker invocation, including a Cron
Trigger tick, at **10ms of CPU time**. The Node version's poller looped
through every tracked listing and parsed each page with `cheerio` (a full
HTML parser) every 90 seconds (Pokémon) / 30 minutes (MTG+Lorcana). That
loop-and-parse-everything design does not fit a 10ms budget.

Two things changed to fit the free plan:

1. **`cheerio` → regex-based extraction** (`src/scrapers.js`). Same
   JSON-LD-first, text-heuristic-fallback approach as before, just without
   building a DOM tree — much less CPU per page.
2. **One setInterval loop → a staggered per-tick rotation** (`src/poll.js`).
   A Cron Trigger fires every minute and checks only **one** listing (two,
   on ticks where both lanes advance), rotating through a fixed order,
   instead of checking an entire tier in one invocation. See the comment
   block at the top of `src/poll.js` for the exact cadence math — as
   shipped, the 4 Pokémon listings + Walmart-drawing check cycle every ~5
   minutes, and the 12 MTG/Lorcana listings cycle every ~36 minutes. That's
   slower than the Node version's 90-second fast tier, but still far ahead
   of the hourly Claude-based check, and it's retunable (see below) without
   costing anything.

Everything else — the restock trigger, the MSRP-anchored "good price"
trigger, the Walmart drawing check, push notifications, the API shape the
frontend reads from — works the same as the Node version.

## What's free here, concretely

- **Workers**: 100,000 requests/day, no credit card. A page view is one
  request; a Cron tick is also one request against this quota. This app
  uses well under 1,500 Cron ticks/day (one a minute) plus whatever traffic
  you actually get — nowhere near the limit.
- **D1** (the database, replacing the Node version's SQLite file): 5GB
  storage, 5M rows read/day, 100k rows written/day, free. This app's tables
  are a few thousand rows at most.
- **No sleep-on-inactivity.** Unlike Render's free web services, nothing
  here pauses because nobody visited — the Cron Trigger keeps ticking
  regardless of traffic. (See the tradeoff this creates in the CPU-time
  section above — it's a different constraint, not "no constraint at all.")

## Before you deploy — the same retailer-blocking caveat as the Node version

Retailer sites block bot-like traffic from cloud IP ranges. This is a
network/IP-reputation issue, not a parsing bug, and it's genuinely unknown
until you deploy which retailers respond from Cloudflare's IPs specifically
— watch `wrangler tail` (or the Cloudflare dashboard's Logs tab) after your
first few Cron ticks to see what's actually getting through.

## One-time setup

You'll need a free Cloudflare account and Node.js installed locally (or use
this same sandbox/CI — `wrangler` works anywhere Node runs).

```bash
cd worker
npm install
npx wrangler login          # opens a browser to authorize the CLI once
```

### 1. Create the D1 database

```bash
npx wrangler d1 create tcgtracker-db
```

This prints a `database_id` — copy it into `wrangler.toml`'s
`[[d1_databases]]` block (the `database_id = ""` line is left blank on
purpose so a deploy fails loudly if you forget this step).

### 2. Apply the schema + seed data

```bash
npm run db:migrate:remote
```

This creates all the tables and seeds the 16 tracked products from
`src/seed-data.js` (mirrors the Node version's `server/seed.js` — same
products, same MSRPs, same TCGPlayer reference snapshot).

### 3. Generate/reuse VAPID keys and set them as secrets

If you already generated VAPID keys for the Node version
(`npm run generate-vapid` in the repo root), **reuse them** — this
library's key format is the same base64url format, no need to regenerate:

```bash
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT     # e.g. mailto:you@example.com
```

(Each prompts for the value interactively — that's intentional, so the key
never ends up in shell history or a committed file.)

### 4. Deploy

```bash
npm run deploy
```

Wrangler prints the live `*.workers.dev` URL. Open it — you should see the
same MTG/Lorcana/Pokémon pages as before, now reading from a live Worker
instead of `localhost:3000`.

### 5. Verify the Cron Trigger is actually running

```bash
npx wrangler tail
```

Wait up to a minute and watch for `[poll]` log lines. If you see fetch
failures for a specific retailer, that's the IP-blocking caveat above, not
a bug — cross-reference which retailers are blocked and lean on the
Claude-based hourly check for those specific ones if it persists.

You can also spot-check the rotation state directly:

```bash
npx wrangler d1 execute tcgtracker-db --remote --command "SELECT * FROM poll_state"
```

### 6. Install it as an app

Same as the Node version: visit the deployed URL on your phone and use
"Add to Home Screen" (iOS Safari) or the install prompt (Android Chrome).
On iOS, push only works after this install step.

## Retuning the poll cadence

- **Faster/slower slow lane**: change `SLOW_LANE_EVERY_N_TICKS` in
  `wrangler.toml`'s `[vars]` block (default `"3"` → ~36min full cycle),
  then `npm run deploy` again.
- **Move a product between lanes**: same admin endpoint as the Node
  version —
  ```bash
  curl -X POST https://your-worker.workers.dev/api/admin/set-tier \
    -H 'Content-Type: application/json' \
    -d '{"product_id": "mtg-reality-fracture-cbb", "tier": "fast"}'
  ```
  Moving more products into the fast lane lengthens its own full-cycle
  time — there's no way to check more things more often without a paid
  plan raising the CPU budget (see below).
- **If you outgrow the free plan's 10ms CPU cap**: Cloudflare's Workers
  Paid plan is $5/month flat (not usage-metered like Railway) and raises
  the Cron Trigger CPU cap to 30 seconds for anything firing more often
  than hourly — at that point you could go back to checking a whole lane
  in one tick if you wanted to.

## Populating `tcgplayer_ref`

Same as the Node version — this starts from the one-time research snapshot
already in `src/seed-data.js`. To update it later:

```bash
npx wrangler d1 execute tcgtracker-db --remote --command \
  "UPDATE products SET tcgplayer_ref=230, tcgplayer_ref_checked_at='$(date -u +%Y-%m-%dT%H:%M:%S.000Z)' WHERE id='pkm-30th-etb'"
```

## Local development

```bash
npm install
npm run db:migrate:local          # applies migrations to a local D1 emulator
cp .dev.vars.example .dev.vars     # fill in VAPID_* values (or leave blank — push is skipped gracefully without them)
npx wrangler dev
```

Open `http://localhost:8787`. To manually fire a Cron tick without waiting
a minute, run `npx wrangler dev --test-scheduled` instead and:

```bash
curl -X POST "http://localhost:8787/cdn-cgi/local/explorer/api/local/scheduled?worker=tcgtracker" \
  -H 'Content-Type: application/json' -d '{"cron":"* * * * *"}'
```

## Project layout

```
worker/
  wrangler.toml         Cloudflare config: D1 binding, static assets binding
                         (points at ../public), Cron Trigger schedule
  migrations/
    0001_init.sql        Schema + seed data, generated from src/seed-data.js
                         (see scripts/gen-migration.mjs) — apply with
                         `npm run db:migrate:remote` / `:local`
  src/
    index.js             Hono app (API routes) + the `scheduled` export
                         Cron Triggers invoke
    db.js                D1 query helpers (async — unlike the Node
                         version's synchronous better-sqlite3-style API)
    scrapers.js           Regex-based JSON-LD/text extraction (see the CPU
                         budget section above for why this isn't cheerio)
    poll.js               The staggered rotation + alert rules (restock,
                         MSRP-anchored good price, Walmart drawing open)
    push.js               Web Push via @block65/webcrypto-web-push (Web
                         Crypto API — the Node version's `web-push` package
                         doesn't run on Workers, see
                         github.com/web-push-libs/web-push/issues/718)
    seed-data.js          The tracked product list — single source of
                         truth for the generated migration
  scripts/
    gen-migration.mjs     Regenerates migrations/0001_init.sql from
                         seed-data.js — only needed if you edit the product
                         list BEFORE your first deploy; after that, treat
                         it like any other production migration (add a new
                         migration file, don't edit 0001)
```

## What this does not replace (yet)

Same as the Node version: the hourly Claude-based scheduled check keeps
running independently. This Worker is additive.
