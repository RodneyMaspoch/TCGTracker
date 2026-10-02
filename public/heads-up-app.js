// heads-up-app.js — fetches /api/heads-up and renders it as a single feed,
// newest first. Deliberately simple (no game tabs/filtering client-side
// yet — see the project doc if that gets added later) since the point of
// this page is "show me everything upcoming across all three games in one
// place," per the explicit ask that spawned this page.

const REFRESH_MS = 30000;
const GAME_LABELS = { pokemon: 'Pokémon', mtg: 'MTG', lorcana: 'Lorcana' };
const SOURCE_LABELS = {
  trackalacker: 'TrackaLacker',
  tcgdropradar: 'TCG Drop Radar',
  autoqueue: 'autoqueue.app',
  'autoqueue-pc': 'autoqueue.app',
  reddit: 'Reddit — r/PokemonTCG',
  restockd: 'Restockd',
};
// Real per-game icon files (see /public/icons/*.png) — shown in the card's
// art band as a plain game indicator, never as a stand-in for a product
// photo (see the comment on .headsup-card in styles.css for why there
// isn't a real one here).
const GAME_ICONS = { pokemon: '/icons/pokemon.png', mtg: '/icons/mtg.png', lorcana: '/icons/lorcana.png' };

const list = document.getElementById('headsUpList');

function timeAgo(iso) {
  const d = new Date(iso);
  const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Cards, not rows (2026-10-02 request): image/icon band, name, store chip,
// the whole card is the link — no separate description paragraph and no
// separate "View source" sub-link, since the card itself already is that
// link. A plain https link to a retailer's own product page already opens
// that retailer's installed app instead of the browser on a phone (iOS
// Universal Links / Android App Links — the OS does this automatically
// for any normal link, nothing extra to build here); "add to cart" isn't
// something a link to someone else's site can do without that retailer's
// own authenticated API, which isn't publicly available, so that part
// really does depend on Restockd's/TrackaLacker's own apps, not this page.
function renderCard(row) {
  const hasLink = !!row.url;
  const card = document.createElement(hasLink ? 'a' : 'div');
  card.className = 'headsup-card';
  if (hasLink) {
    card.href = row.url;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
  }

  const art = document.createElement('div');
  art.className = 'headsup-art';
  const iconSrc = GAME_ICONS[row.game];
  if (iconSrc) {
    const icon = document.createElement('img');
    icon.className = 'headsup-art-icon';
    icon.src = iconSrc;
    icon.alt = '';
    art.appendChild(icon);
  }
  card.appendChild(art);

  const body = document.createElement('div');
  body.className = 'headsup-body';

  const top = document.createElement('div');
  top.className = 'headsup-top';
  const badge = document.createElement('span');
  badge.className = 'headsup-badge';
  badge.textContent = 'UNCONFIRMED';
  top.appendChild(badge);
  if (row.retailer) {
    const retailerChip = document.createElement('span');
    retailerChip.className = 'headsup-retailer-chip';
    retailerChip.textContent = row.retailer;
    top.appendChild(retailerChip);
  }
  if (row.game) {
    const chip = document.createElement('span');
    chip.className = 'headsup-game-chip';
    chip.textContent = GAME_LABELS[row.game] || row.game;
    top.appendChild(chip);
  }
  body.appendChild(top);

  const title = document.createElement('div');
  title.className = 'headsup-title';
  title.textContent = row.title;
  body.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'headsup-meta';
  const source = document.createElement('span');
  source.className = 'headsup-source';
  source.textContent = `${SOURCE_LABELS[row.source] || row.source} · ${timeAgo(row.discovered_at)}`;
  meta.appendChild(source);
  body.appendChild(meta);

  card.appendChild(body);
  return card;
}

async function load() {
  // Was: any failure here (network error, or the API returning a
  // non-JSON error body) landed in the catch block and did NOTHING to
  // the page — no card, no empty-state, no error, just a blank list
  // forever. That's indistinguishable from "the feature is broken" even
  // when the real cause is something fixable (most likely: the
  // heads_up table doesn't exist yet because migration 0002 hasn't been
  // applied in D1). Now every outcome puts SOME visible text in the list.
  try {
    const res = await fetch('/api/heads-up?limit=50');
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`API returned ${res.status}${body ? ` — ${body.slice(0, 200)}` : ''}`);
    }
    const rows = await res.json();
    list.innerHTML = '';
    if (!rows || rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = "Nothing flagged yet — that's normal, this checks a handful of sources every few minutes and only shows up when one of them mentions something dated and specific.";
      list.appendChild(empty);
      return;
    }
    for (const row of rows) list.appendChild(renderCard(row));
  } catch (err) {
    console.error('[heads-up] load failed', err);
    list.innerHTML = '';
    const errBox = document.createElement('div');
    errBox.className = 'empty-state';
    errBox.textContent = `Couldn't load heads-up data (${err.message || 'unknown error'}). If you just deployed this, make sure migration 0002_heads_up.sql has been applied in D1 — this page depends on that table existing.`;
    list.appendChild(errBox);
  }
}

(async function init() {
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('/sw.js'); } catch (err) { console.error('[heads-up] sw register failed', err); }
  }
  await load();
  setInterval(load, REFRESH_MS);
})();
