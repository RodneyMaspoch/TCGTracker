// checkout-helpers.js — 2026-10-14
//
// Context: after shipping the Nintendo Algolia search + the overlap/marquee/
// toast fixes, the user's real ask was "build something that adds to cart
// AND clicks checkout for me, under 10 seconds, even just to test." That
// was declined — a scripted add-to-cart-through-checkout flow against a
// third-party retailer's site is the same thing whether it's called a
// "test" or not, and it runs into the same ToS/legal/account-risk problems
// either way, including on the user's own account. See the project doc
// entry dated 2026-10-14 for the full reasoning.
//
// What ships here instead are the three LEGITIMATE speed-ups the user also
// picked from the same answer. None of these add anything to a cart or
// submit a purchase on their own — they only build a link or show text; a
// human still clicks every step:
//
//   1. Amazon quick-add link — Amazon's own long-public, documented
//      "Add to Cart Form" URL (https://www.amazon.com/gp/aws/cart/add.html).
//      Loading it puts the item in *your own, already-logged-in* Amazon
//      cart. No API key, no scripting, no bypassing a login — it's exactly
//      what clicking "Add to Cart" on Amazon does, just reachable from one
//      link instead of a product-page visit + button click. You still have
//      to open your cart and click "Proceed to checkout" yourself.
//      IMPORTANT: this project doesn't currently track any Amazon listings,
//      so buildAmazonQuickAddButton() will simply return null for every
//      listing right now (real retailer field, never guessed/faked) — it's
//      wired up and ready for the day an Amazon URL gets tracked.
//   2. Per-product "quick launch" — for every other tracked retailer there
//      is no public, documented way to pre-load a cart via a URL (Target,
//      Best Buy, Walmart, GameStop, Nintendo, etc. all require a live
//      session/CSRF token to add to cart, which is exactly the kind of
//      scripted-against-their-backend behavior the checkout bot was
//      declined for). So "quick launch" here is honest about what's really
//      available: the direct link straight to that product's own page
//      (already present everywhere a card links out) — not fabricating a
//      cart-add URL that doesn't exist for retailers that don't support one.
//   3. A checkout-speed checklist — real, retailer-specific account/device
//      settings (guest checkout, saved payment, app notifications) that
//      speed up the HUMAN part of checkout, surfaced right on the card so
//      it isn't something the user has to remember or look up mid-drop.

(function (global) {
  'use strict';

  function extractAsin(url) {
    if (!url) return null;
    const m =
      String(url).match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?#]|$)/i) ||
      String(url).match(/[?&]ASIN=([A-Z0-9]{10})/i);
    return m ? m[1].toUpperCase() : null;
  }

  function buildAmazonAddToCartUrl(url, quantity) {
    const asin = extractAsin(url);
    if (!asin) return null;
    const qty = Math.max(1, Math.min(99, Number(quantity) || 1));
    return `https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=${asin}&Quantity.1=${qty}`;
  }

  const GENERIC_CHECKLIST = [
    'Save a payment method and shipping address on this retailer’s site or app ahead of time, so checkout is just a confirm tap.',
    'Turn on push notifications in this app (see the bell / notifications prompt) so a restock alert reaches your phone the second it’s detected.',
    'Open the retailer’s own app instead of a mobile browser when you can — most retail apps check out faster than their mobile site.',
  ];

  const RETAILER_CHECKLISTS = {
    amazon: [
      'Use the "Quick-add to Amazon cart" button on this card — it opens Amazon with the item already in your cart via Amazon’s own add-to-cart link, so you only need to tap "Proceed to checkout."',
      ...GENERIC_CHECKLIST,
    ],
    target: ['Target supports guest checkout — turn it on in your account settings so you’re not forced to log in mid-checkout.', ...GENERIC_CHECKLIST],
    walmart: ['Walmart supports guest checkout, or stay logged in on the device you’ll use.', ...GENERIC_CHECKLIST],
    walmart_marketplace: ['This is a 3rd-party Marketplace seller on Walmart — confirm the seller and return policy once, ahead of time, so you’re not reading it mid-checkout.', ...GENERIC_CHECKLIST],
    bestbuy: ['Best Buy checkout is faster when you’re logged into a My Best Buy account with a saved card — guest checkout exists but asks for more at the end.', ...GENERIC_CHECKLIST],
    gamestop: ['GameStop supports guest checkout; if you have a PowerUp Rewards account, stay logged in for faster address/payment autofill.', ...GENERIC_CHECKLIST],
    nintendo: ['Nintendo Store checkout requires a Nintendo Account — make sure you’re logged in beforehand with a saved payment method; some hardware restocks are account-gated or limited per account.', ...GENERIC_CHECKLIST],
    secretlair: ['Secret Lair drops run through Wizards’ own store — verify your account and saved payment before a known drop window.', ...GENERIC_CHECKLIST],
    disneylorcana: ['disneylorcana.com checkout needs an account — verify login and saved payment ahead of a preorder window.', ...GENERIC_CHECKLIST],
    ravensburger: GENERIC_CHECKLIST,
    miniaturemarket: ['Miniature Market supports guest checkout; a saved account speeds up repeat preorders.', ...GENERIC_CHECKLIST],
    pokemoncenter: ['Pokémon Center checkout requires an account and is often queue/limit-gated during drops — be logged in with payment saved well before the restock window.', ...GENERIC_CHECKLIST],
    samsclub: ['Sam’s Club checkout requires an active membership (or a Plus/Instacart account for delivery) — have that and a saved payment method ready; in-club-only stock won’t show as purchasable online even when the shelf has it.', ...GENERIC_CHECKLIST],
  };

  function getChecklist(retailer) {
    const key = String(retailer || '').toLowerCase().replace(/\s+/g, '');
    return RETAILER_CHECKLISTS[key] || GENERIC_CHECKLIST;
  }

  // DOM builders for the vanilla-JS card renderers (pokemon-app.js,
  // nintendo-app.js). Each returns null when there's nothing real to show
  // (e.g. no Amazon ASIN), rather than rendering an empty/fake affordance.
  function buildChecklistDetails(retailer) {
    const details = document.createElement('details');
    details.className = 'tcg-checkout-checklist';
    const summary = document.createElement('summary');
    summary.textContent = 'Checkout speed checklist';
    details.appendChild(summary);
    const ul = document.createElement('ul');
    for (const item of getChecklist(retailer)) {
      const li = document.createElement('li');
      li.textContent = item;
      ul.appendChild(li);
    }
    details.appendChild(ul);
    return details;
  }

  function buildAmazonQuickAddButton(url) {
    const addUrl = buildAmazonAddToCartUrl(url);
    if (!addUrl) return null;
    const a = document.createElement('a');
    a.className = 'tcg-quickadd-btn';
    a.href = addUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = '⚡ Quick-add to Amazon cart';
    a.title = 'Opens Amazon with this item already in your cart (Amazon’s own add-to-cart link) — you still click Proceed to checkout yourself.';
    return a;
  }

  global.TCGCheckoutHelpers = {
    extractAsin,
    buildAmazonAddToCartUrl,
    getChecklist,
    buildChecklistDetails,
    buildAmazonQuickAddButton,
  };
})(window);
