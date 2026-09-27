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
  INSERT INTO products (id, game, name, msrp, poll_tier)
  VALUES (@id, @game, @name, @msrp, @poll_tier)
  ON CONFLICT(id) DO UPDATE SET game=excluded.game, name=excluded.name, msrp=excluded.msrp
`);

const upsertListing = db.prepare(`
  INSERT INTO retailer_listings (product_id, retailer, url)
  VALUES (@product_id, @retailer, @url)
  ON CONFLICT(product_id, retailer) DO UPDATE SET url=excluded.url
`);

const PRODUCTS = [
  // ---------------- POKEMON (fast tier) ----------------
  {
    id: 'pkm-30th-etb', game: 'pokemon', name: '30th Celebration — Elite Trainer Box', msrp: 49.99, poll_tier: 'fast',
    listings: [
      { retailer: 'bestbuy', url: 'https://www.bestbuy.com/product/pokemon-trading-card-game-30th-celebration-elite-trainer-box/JJG2TL8XCJ' },
      { retailer: 'gamestop', url: 'https://www.gamestop.com/toys-games/trading-cards/products/pokemon-trading-card-game-30th-celebration-elite-trainer-box/20036324.html' },
    ],
  },
  {
    id: 'pkm-30th-upc-day', game: 'pokemon', name: '30th Celebration — Ultra Premium Collection (Day)', msrp: 179.99, poll_tier: 'fast',
    listings: [],
  },
  {
    id: 'pkm-delta-reign-etb', game: 'pokemon', name: 'Delta Reign — Elite Trainer Box', msrp: 49.99, poll_tier: 'fast',
    listings: [
      { retailer: 'bestbuy', url: 'https://www.bestbuy.com/product/pokemon-trading-card-game-mega-evolution-delta-reign-elite-trainer-box/JJG2TL8QGY' },
    ],
  },
  {
    id: 'pkm-prismatic-etb', game: 'pokemon', name: 'Prismatic Evolutions — Elite Trainer Box', msrp: 69.99, poll_tier: 'fast',
    listings: [
      { retailer: 'bestbuy', url: 'https://www.bestbuy.com/product/pokemon-trading-card-game-scarlet-violet-prismatic-evolutions-elite-trainer-box/JJG2TLCW3L' },
    ],
  },

  // ---------------- MTG (slow tier) ----------------
  {
    id: 'mtg-reality-fracture-cbb', game: 'mtg', name: 'Reality Fracture — Collector Booster Box', msrp: 323.88, poll_tier: 'slow',
    listings: [
      { retailer: 'bestbuy', url: 'https://www.bestbuy.com/product/wizards-of-the-coast-magic-the-gathering-reality-fracture-collector-booster-box-12-packs/JJ8VP7ZRYS' },
      { retailer: 'target', url: 'https://www.target.com/p/magic-the-gathering-reality-fracture-coll-booster-box-12ct/-/A-1012055749' },
    ],
  },
  {
    id: 'mtg-star-trek-cbb', game: 'mtg', name: 'Star Trek — Collector Booster Box', msrp: 479.99, poll_tier: 'slow',
    listings: [
      { retailer: 'bestbuy', url: 'https://www.bestbuy.com/product/wizards-of-the-coast-magic-the-gathering-star-trek-collector-booster-box-12-packs/JJ8VP7ZYQC' },
    ],
  },
  {
    id: 'mtg-odds-and-ends', game: 'mtg', name: 'Secret Lair Commander: Odds and Ends', msrp: 149.99, poll_tier: 'slow',
    listings: [],
  },

  // ---------------- LORCANA (slow tier) ----------------
  {
    id: 'lor-hyperia-city-bb', game: 'lorcana', name: 'Hyperia City — Booster Box', msrp: 143.76, poll_tier: 'slow',
    listings: [
      { retailer: 'target', url: 'https://www.target.com/p/disney-lorcana-trading-card-game-hyperia-city-booster-display-box/-/A-1013166579' },
      { retailer: 'gamestop', url: 'https://www.gamestop.com/toys-games/trading-cards/products/disney-lorcana-hyperia-city-chapter-14-booster-box/20037454.html' },
    ],
  },
  {
    id: 'lor-attack-of-the-vine-bb', game: 'lorcana', name: 'Attack of the Vine! — Booster Box', msrp: 143.76, poll_tier: 'slow',
    listings: [
      { retailer: 'bestbuy', url: 'https://www.bestbuy.com/product/disney-lorcana-attack-of-the-vine-booster-box-24-packs/CJ6QGKYQT7/sku/6680144' },
    ],
  },
  {
    id: 'lor-wilds-unknown-bb', game: 'lorcana', name: 'Wilds Unknown — Booster Box', msrp: 143.76, poll_tier: 'slow',
    listings: [
      { retailer: 'bestbuy', url: 'https://www.bestbuy.com/product/disney-lorcana-wilds-unknown-booster-box-24-packs/CJ6QGKQGXV/sku/12646788' },
    ],
  },
];

function seed() {
  const insertMany = db.transaction((products) => {
    for (const p of products) {
      upsertProduct.run({ id: p.id, game: p.game, name: p.name, msrp: p.msrp, poll_tier: p.poll_tier });
      for (const l of p.listings || []) {
        upsertListing.run({ product_id: p.id, retailer: l.retailer, url: l.url });
      }
    }
  });
  insertMany(PRODUCTS);
  console.log(`[seed] ${PRODUCTS.length} products seeded/updated.`);
}

module.exports = { seed, PRODUCTS };

if (require.main === module) seed();
