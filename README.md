# TCGTracker (PWA)

A self-hosted, installable web app that tracks MTG, Disney Lorcana, and
Pokémon TCG restocks and prices, and sends real push notifications the
moment something changes — even if the app isn't open. This replaces the
three separate Claude-hosted dashboards with one app, backed by a small
server that polls retailer pages on its own schedule (not once an hour on
a Claude check-in).

## Why this exists

The hourly Claude-based check is inherently on an hourly clock — fine for
slow-moving MSRP/price watching, too slow for a true first-come-first-served
restock. This app runs its own server with two poll tiers:

- **Fast tier (default 90s):** Pokémon products, per your scoping choice to
  start narrow. Also polls the Walmart Collectibles Drawing page.
- **Slow tier (default 30min):** MTG + Disney Lorcana, roughly matching what
  the hourly Claude check already did, now folded into the same data source.

You can widen the fast tier to any product later via `POST /api/admin/set-tier`
(see below) — nothing about the two-tier design is Pokémon-specific, it's
just where you asked to start.

**Boundary that's carried through unchanged:** this only ever reads pages.
It never adds to cart, logs in, or enters the Walmart drawing for you.

## Before you deploy — read this

Retailer sites actively block bot-like traffic, including requests from
generic cloud-hosting IP ranges (this is true of Railway/Fly/Render's
shared IPs too, not just this sandbox). In local testing here, Best Buy,
Target, GameStop, and Walmart all returned `HTTP 403` to a plain scripted
request — this is expected and is a real constraint on this whole category
of tool, not a bug to "fix" by tweaking headers. Two things follow:

1. **Test against your actual deploy target before trusting it.** Deploy,
   watch the logs (`console.log` on every fetch failure), and see which
   retailers actually respond from that host's IPs. Some may work, some may
   not, and it can change over time as retailers adjust their blocking.
2. **The scraping logic itself is solid and future-proofed reasonably well**
   (it prefers each page's embedded schema.org product data over fragile CSS
   selectors — see the comment block at the top of `server/scrapers.js`), so
   if a retailer is blocking you, that's a network/IP reputation problem, not
   a parsing problem.

If a specific retailer consistently 403s from your host, options (in rough
order of effort) are: try a different low-cost host, add a residential/
datacenter-proxy fetch layer (extra cost, not included here), or just accept
that retailer isn't covered by the fast loop and lean on the Claude-based
hourly check for it instead. This is worth knowing going in rather than
discovering it after you've deployed and started trusting alerts that
never fire.

## Project layout

```
server/
  index.js        Express app + all API routes
  db.js           SQLite schema (Node's built-in node:sqlite, one file — no native compiling needed)
  seed.js         Seeds the 16 tracked products (edit this to add/remove products — see below)
  scrapers.js     Fetch + parse retailer pages (JSON-LD first, text fallback)
  poller.js       The two-tier polling loop + alert rules (restock, good price, drawing open)
  push.js         Web Push (VAPID) send/subscribe/unsubscribe
  generate-vapid.js  One-time CLI helper to print a VAPID key pair
public/
  index.html      The real MTG dashboard ("Spellwatch") — your original design, untouched
  lorcana.html    The real Lorcana dashboard ("Inkwatch") — same
  pokemon.html, pokemon-app.js, pokemon-styles.css
                  A temporary bridge page for Pokémon (no matching legacy
                  page existed for this game) — different visual style
                  from the other two on purpose, until it's rebuilt to match
  runtime.js      The template engine index.html/lorcana.html are built on
                  (converts their `{{ }}` / `sc-if` / `sc-for` markup to
                  plain DOM updates — this is what makes them work as
                  static files with no build step)
  pwa-boot.js     The ONLY new logic added to index.html/lorcana.html:
                  registers the service worker, and patches each page's own
                  `ALL_DEALS` array in place with live price/stock from
                  this server, matched by URL — everything else in those
                  two pages (layout, copy, images, interactions) is exactly
                  as it was
  img/            Product photos used by index.html/lorcana.html
  manifest.json   PWA install manifest
  sw.js           Service worker — network-first shell cache + push receiver
  icons/          App icons (192px, 512px)
```

### How the live-data wiring works

`index.html` and `lorcana.html` each define a plain JS array near the bottom
of the file — `const ALL_DEALS = [...]` — with one entry per tracked
listing (name, retailer, url, price, stock, msrp, etc.). That's the data
the page renders from. `pwa-boot.js` fetches `/api/products` on load (and
every 20s after) and, for every `ALL_DEALS` entry whose `url` matches a
listing this server actually tracks, overwrites that entry's `price`,
`stock`, `delta`, `under`, and `ago` fields with the live value, then
triggers a re-render. A listing whose URL isn't in `server/seed.js` yet
just keeps showing its original curated numbers — nothing breaks, it
simply doesn't update until you add that URL to `seed.js`.

To track a new product: add it to the `PRODUCTS` array in `server/seed.js`
(id, game, name, msrp, a URL) AND add a matching entry to the page's own
`ALL_DEALS` array with the exact same `url` — the two have to agree on the
URL for the live patch to find it.

## Run it locally

Needs Node.js **v22.5.0 or newer** (uses Node's own built-in SQLite support,
so there's nothing to compile — no Visual Studio Build Tools or Xcode CLI
tools required, even on a fresh Windows/Mac machine).

```bash
npm install
npm run generate-vapid        # prints a VAPID key pair — paste into .env
cp .env.example .env           # then fill in the VAPID_* values
npm start                      # serves on http://localhost:3000
```

Open `http://localhost:3000` in Chrome. Click **Enable alerts** to test the
push flow end-to-end (grant the browser permission prompt). Trigger a test
notification any time with:

```bash
curl -X POST http://localhost:3000/api/push/test
```

Without VAPID keys set, the server still runs fully (dashboard, API, in-app
alert list) — it just skips sending real push notifications and logs a
warning, so you can develop without generating keys every time.

## Deploying (free-tier hosting)

Any of Railway, Fly.io, or Render will work — they all support: a Node
buildpack, environment variables, and (importantly) a **persistent volume**,
which you need so the SQLite file survives redeploys. Steps are the same
shape everywhere:

1. Push this folder to a git repo (a `.gitignore` is already set up to keep
   `node_modules`, `.env`, and the local `.db` file out of it).
2. Create a new app on your chosen host, pointed at that repo.
   - Build command: `npm install`
   - Start command: `npm start`
3. Attach a persistent volume/disk, mounted at e.g. `/data`.
4. Set environment variables in the host's dashboard:
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — from
     `npm run generate-vapid`, run once locally.
   - `DB_PATH=/data/tcgtracker.db` — pointing at the volume from step 3, so
     tracked history and push subscriptions survive a redeploy.
   - `PORT` — most hosts set this for you automatically; only set it
     yourself if the host requires it.
   - Leave `FAST_INTERVAL_MS` / `SLOW_INTERVAL_MS` unset to use the 90s /
     30min defaults, or override them (milliseconds) if you want to tune
     cadence later.
5. Deploy. Watch the logs for the first few poll cycles to see which
   retailers are actually reachable from that host (see the section above).
6. Visit the deployed URL on your phone, and use the browser's **"Add to
   Home Screen"** (iOS Safari) or the install prompt (Android Chrome) to
   install it as an app. On iOS, push notifications only work *after* this
   install step — a plain Safari tab can't receive them.

## Getting `tcgplayer_ref` populated (for the "good price" alert)

The bold "good price" alert (`poller.js`, Trigger 2b — this mirrors the
standing rule you set for the Claude-based check) is anchored to **MSRP**,
not to TCGPlayer directly. TCGPlayer is almost always well above MSRP for
the kind of hyped sealed product this app tracks, so a version that just
compares live price to TCGPlayer ends up flagging any marked-up scalper
listing as a "deal" the moment it happens to undercut TCGPlayer's inflated
ceiling. Instead, it fires only when **both** hold:

1. TCGPlayer is meaningfully above MSRP (`GOOD_PRICE_MIN_MARKUP`, default
   25%) — this is what tells you the product actually carries real resale
   demand worth caring about.
2. The retail price you'd actually pay is at or near MSRP
   (`GOOD_PRICE_MAX_PREMIUM`, default 10% over MSRP) — this is what
   confirms *this specific listing* isn't itself a marked-up price.

Both thresholds are environment variables you can tune (see `.env.example`).
Either way, the comparison needs each product's `tcgplayer_ref` column,
which starts out empty for every seeded product. Two ways to fill it in:

- **Manual, quick:** run a one-off SQL update whenever you have a fresh
  TCGPlayer/secondary-market reference price (same MTGStocks/PriceCharting
  research approach already used in the Claude-based checks):
  ```bash
  node -e "require('./server/db').prepare('UPDATE products SET tcgplayer_ref=?, tcgplayer_ref_checked_at=? WHERE id=?').run(230, new Date().toISOString(), 'pkm-30th-etb')"
  ```
- **Scripted refresh:** add a small scheduled job (a third poll tier, or a
  cron endpoint you hit manually) that re-derives these reference prices
  periodically. Not built in yet since it needs the same manual research
  step the Claude-based check already does well — this is the one piece
  still worth doing by hand or handing back to the Claude-based check to
  keep populating going forward.

## Editing the tracked product list

Edit the `PRODUCTS` array in `server/seed.js` — add a product with its
`game`, `msrp`, `poll_tier` (`'fast'` or `'slow'`), and a `listings` array
of `{ retailer, url }` retailer product pages. Seeding runs automatically on
every boot and is safe to re-run (it upserts by product id).

To move a product between tiers without redeploying, call:

```bash
curl -X POST https://your-app.example.com/api/admin/set-tier \
  -H 'Content-Type: application/json' \
  -d '{"product_id": "mtg-reality-fracture-cbb", "tier": "fast"}'
```

(This endpoint has no auth on it — fine for personal use behind an
obscure URL, but don't link it publicly without adding at least a shared
secret header if you're worried about randoms flipping your poll tiers.)

## What this does not replace (yet)

The hourly Claude-based scheduled check (MTG/Lorcana/Pokémon dashboards +
the project doc log) keeps running independently — this PWA is additive,
not a replacement, unless you decide otherwise. It's a reasonable source
of the periodic TCGPlayer reference-price research this app needs, until
that gets automated here too.
