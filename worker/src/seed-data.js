// seed-data.js — the tracked product list, carried over verbatim from
// server/seed.js (the Node/Express version). This is the single source of
// truth for what gets seeded into D1 on first deploy (see
// migrations/0001_init.sql, which is generated from this file — see
// worker/scripts/gen-migration.js).
//
// IMPORTANT: if you edit this file to add/remove/change a product, you must
// also regenerate the migration (`node scripts/gen-migration.js`) if you
// haven't deployed yet, OR — if you've already deployed — apply the change
// with a one-off D1 write (wrangler d1 execute ...) or a new migration file,
// the same way you'd edit any other production database. Editing this file
// alone does NOT change an already-seeded D1 database.
//
// poll_tier 'fast' products rotate through the fast lane (default: one
// listing checked per minute, so a 5-slot fast lane completes a full cycle
// every ~5 minutes). poll_tier 'slow' products rotate through the slow lane,
// advanced only every SLOW_LANE_EVERY_N_TICKS ticks (see poll.js) — a
// 12-slot slow lane at "every 3rd tick" completes a full cycle every ~36
// minutes. See poll.js for the exact staggering logic and how to retune it.

const REF_CHECKED_AT = '2026-09-27T21:00:00.000Z';

export const PRODUCTS = [
  // ---------------- POKEMON (fast lane) ----------------
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

  // ---------------- MTG (slow lane) ----------------
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

  // ---------------- LORCANA (slow lane) ----------------
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

export { REF_CHECKED_AT };
