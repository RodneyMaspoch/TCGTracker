// seed.js — one-time seed of the tracked product list, carried over from the
// Claude-hosted TCGTracker dashboards. Run automatically on server boot
// (safe to re-run — uses INSERT OR IGNORE / INSERT OR REPLACE on product id).
//
// poll_tier 'fast' products are checked every ~90s by poller.js.
// poll_tier 'slow' products are checked every ~30min.
// You chose to start the fast loop with Pokémon only — MTG/Lorcana are
// seeded as 'slow' so the PWA still shows all three games, just on a
// gentler cadence. Bump a product to 'fast' any time by editing its row
// (see the /api/admin/set-tier endpoint in index.js) once you're ready
// to widen the fast loop.

const db = require('./db');

const upsertProduct = db.prepare(`
  INSERT INTO products (id, game, name, msrp, poll_tier, tcgplayer_ref, tcgplayer_ref_checked_at)
  VALUES (@id, @game, @name, @msrp, @poll_tier, @tcgplayer_ref, @tcgplayer_ref_checked_at)
  ON CONFLICT(id) DO UPDATE SET
    game=excluded.game, name=excluded.name, msrp=excluded.msrp,
    tcgplayer_ref=COALESCE(products.tcgplayer_ref, excluded.tcgplayer_ref),
    tcgplayer_ref_checked_at=COALESCE(products.tcgplayer_ref_checked_at, excluded.tcgplayer_ref_checked_at)
`);
// Note the COALESCE on the two tcgplayer_ref columns: seed() re-runs on
// every server boot, and a live poll cycle (or a manual update — see the
// README) may have already refreshed these since the initial seed. This
// keeps the *newer* value instead of stomping it back to the seed default
// every restart.

// TCGPlayer reference prices below are the same one-time research snapshot
// from the "TCGPlayer / secondary-market pricing snapshot" table in the
// project doc (researched ~2026-09-27). They're a starting point, not
// live — re-check via MTGStocks/PriceCharting and update through the
// admin flow described in the README as they age. Left null where no
// secondary-market data exists yet (not released / not enough sold volume).
const REF_CHECKED_AT = '2026-09-27T21:00:00.000Z';

const upsertListing = db.prepare(`
  INSERT INTO retailer_listings (product_id, retailer, url)
  VALUES (@product_id, @retailer, @url)
  ON CONFLICT(product_id, retailer) DO UPDATE SET url=excluded.url
`);

const PRODUCTS = [
  // ---------------- POKEMON (fast tier) ----------------
  {
    id: 'pkm-30th-etb', game: 'pokemon', name: '30th Celebration — Elite Trainer Box', msrp: 49.99, poll_tier: 'fast', tcgplayer_ref: 168.78,
    listings: [
      { retailer: 'bestbuy', url: 'https://www.bestbuy.com/product/pokemon-trading-card-game-30th-celebration-elite-trainer-box/JJG2TL8XCJ' },
      { retailer: 'gamestop', url: 'https://www.gamestop.com/toys-games/trading-cards/products/pokemon-trading-card-game-30th-celebration-elite-trainer-box/20036324.html' },
    ],
  },
  {
    id: 'pkm-30th-upc-day', game: 'pokemon', name: '30th Celebration — Ultra Premium Collection (Day)', msrp: 179.99, poll_tier: 'fast', tcgplayer_ref: 566.23,
    listings: [],
  },
  {
    id: 'pkm-delta-reign-etb', game: 'pokemon', name: 'Delta Reign — Elite Trainer Box', msrp: 49.99, poll_tier: 'fast', tcgplayer_ref: null, // not released yet (Nov 6) — no secondary data
    listings: [
      { retailer: 'bestbuy', url: 'https://www.bestbuy.com/product/pokemon-trading-card-game-mega-evolution-delta-reign-elite-trainer-box/JJG2TL8QGY' },
    ],
  },
  {
    id: 'pkm-prismatic-etb', game: 'pokemon', name: 'Prismatic Evolutions — Elite Trainer Box', msrp: 69.99, poll_tier: 'fast', tcgplayer_ref: 138.86,
    listings: [
      { retailer: 'bestbuy', url: 'https://www.bestbuy.com/product/pokemon-trading-card-game-scarlet-violet-prismatic-evolutions-elite-trainer-box/JJG2TLCW3L' },
    ],
  },

  // ---------------- MTG (slow tier) ----------------
  // These match the exact deal cards + URLs in public/index.html's own
  // ALL_DEALS array (the real "Spellwatch" dashboard) one-to-one by id, so
  // pwa-boot.js's live-data patch can find each one by URL. One product
  // per listing here — the page treats "same item, two retailers" as two
  // separate deal cards, so this mirrors that instead of merging them.
  {
    id: 'hobbit-target', game: 'mtg', name: 'The Hobbit — Play Booster Display', msrp: 224.99, poll_tier: 'slow',
    listings: [{ retailer: 'target', url: 'https://www.target.com/p/magic-the-gathering-the-hobbit-play-booster-display/-/A-1012055693' }],
  },
  {
    id: 'hobbit-walmart', game: 'mtg', name: 'The Hobbit — Play Booster Display', msrp: 179.99, poll_tier: 'slow',
    listings: [{ retailer: 'walmart', url: 'https://www.walmart.com/ip/Magic-The-Gathering-The-Hobbit-Play-Booster-Display/20213053526' }],
  },
  {
    id: 'doom-prevails', game: 'mtg', name: 'Marvel Super Heroes Commander Deck — Doom Prevails', msrp: null, poll_tier: 'slow',
    listings: [{ retailer: 'bestbuy', url: 'https://www.bestbuy.com/product/wizards-of-the-coast-magic-the-gathering-marvel-super-heroes-commander-deck-doom-prevails/JJ8VP7KSL7' }],
  },
  {
    id: 'reality-fracture-sld-target', game: 'mtg', name: 'Reality Fracture — Secret Lair Bundle', msrp: 89.99, poll_tier: 'slow',
    listings: [{ retailer: 'target', url: 'https://www.target.com/p/magic-the-gathering-reality-fracture-secret-lair-bundle/-/A-1012055753' }],
  },
  {
    id: 'reality-fracture-sld-walmart', game: 'mtg', name: 'Reality Fracture — Secret Lair Bundle (3rd-party seller)', msrp: 89.99, poll_tier: 'slow',
    listings: [{ retailer: 'walmart_marketplace', url: 'https://www.walmart.com/ip/MTG-REALITY-FRACTURE-SLD-BUNDLE/20843517878' }],
  },
  {
    id: 'motu-secretlair', game: 'mtg', name: 'Secret Lair × Masters of the Universe (per set)', msrp: 29.99, poll_tier: 'slow',
    listings: [{ retailer: 'secretlair', url: 'https://secretlair.wizards.com/us/en/product/1254739/secret-lair-x-masters-of-the-universe-sold-separately' }],
  },

  // ---------------- LORCANA (slow tier) ----------------
  // Same idea — matches public/lorcana.html's own ALL_DEALS array ("Inkwatch").
  {
    id: 'aotv-target', game: 'lorcana', name: 'Attack of the Vine! Booster Display', msrp: 143.76, poll_tier: 'slow',
    listings: [{ retailer: 'target', url: 'https://www.target.com/p/lorcana-trading-card-game-attack-of-the-vine-booster-display/-/A-1011483405' }],
  },
  {
    id: 'aotv-walmart', game: 'lorcana', name: 'Attack of the Vine! Booster Box (3rd-party seller)', msrp: 143.76, poll_tier: 'slow',
    listings: [{ retailer: 'walmart_marketplace', url: 'https://www.walmart.com/ip/Disney-Lorcana-Trading-Card-Game-Attack-of-the-Vine-Booster-Box-24-Packs/20663157247' }],
  },
  {
    id: 'aotv-bestbuy', game: 'lorcana', name: 'Attack of the Vine! Booster Box', msrp: 143.76, poll_tier: 'slow',
    listings: [{ retailer: 'bestbuy', url: 'https://www.bestbuy.com/product/disney-lorcana-attack-of-the-vine-booster-box-24-packs/CJ6QGKYQT7/sku/6680144' }],
  },
  {
    id: 'hyperia-box-mm', game: 'lorcana', name: 'Hyperia City Booster Box (preorder)', msrp: 143.76, poll_tier: 'slow',
    listings: [{ retailer: 'miniaturemarket', url: 'https://www.miniaturemarket.com/Lorcana-TCG-Hyperia-City-Booster-Box-24-Preorder/RVN11090098-BOX' }],
  },
  {
    id: 'hyperia-trove', game: 'lorcana', name: "Hyperia City — Illumineer's Trove", msrp: 49.99, poll_tier: 'slow',
    listings: [{ retailer: 'disneylorcana', url: 'https://www.disneylorcana.com/en-US/product/hyperia-city' }],
  },
  {
    id: 'hunny-rescue', game: 'lorcana', name: "Illumineer's Quest: The Great Hunny Rescue", msrp: null, poll_tier: 'slow',
    listings: [{ retailer: 'ravensburger', url: 'https://www.disneylorcana.com/en-GB/product/great-hunny-rescue' }],
  },
];

function seed() {
  // node:sqlite's DatabaseSync has no .transaction() helper (that's a
  // better-sqlite3-only convenience) — wrap the batch in BEGIN/COMMIT by
  // hand instead. Ten rows, so plain manual transaction handling is fine.
  db.exec('BEGIN');
  try {
    for (const p of PRODUCTS) {
      upsertProduct.run({
        id: p.id, game: p.game, name: p.name, msrp: p.msrp, poll_tier: p.poll_tier,
        tcgplayer_ref: p.tcgplayer_ref ?? null,
        tcgplayer_ref_checked_at: p.tcgplayer_ref ? REF_CHECKED_AT : null,
      });
      for (const l of p.listings || []) {
        upsertListing.run({ product_id: p.id, retailer: l.retailer, url: l.url });
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  console.log(`[seed] ${PRODUCTS.length} products seeded/updated.`);
}

module.exports = { seed, PRODUCTS };

if (require.main === module) seed();
