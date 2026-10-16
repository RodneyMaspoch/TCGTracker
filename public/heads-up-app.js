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
  hotstock: 'HotStock',
  'official-mtg': 'Wizards of the Coast (official)',
  'official-lorcana': 'Disney Lorcana (official)',
  'official-pokemon': 'Pokémon press site (official)',
  'walmart-new': 'Walmart (direct)',
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
// 2026-10-15 — same clean list-row design as the Alerts page. Titles are
// HTML-decoded (sources sometimes send "&amp;"), and identical tips from
// the same source are shown once.
function decode(str) {
  const t = document.createElement('textarea');
  t.innerHTML = str || '';
  return t.value;
}

function renderCard(row) {
  const card = document.createElement(row.url ? 'a' : 'div');
  card.className = 'tl-item';
  if (row.url) { card.href = row.url; card.target = '_blank'; card.rel = 'noopener noreferrer'; }

  const icon = document.createElement('div');
  icon.className = 'tl-item-icon';
  if (GAME_ICONS[row.game]) icon.innerHTML = `<img src="${GAME_ICONS[row.game]}" alt="">`;
  card.appendChild(icon);

  const main = document.createElement('div');
  main.className = 'tl-item-main';
  const tags = document.createElement('div');
  tags.className = 'tl-item-tags';
  const badge = document.createElement('span');
  const official = String(row.source).startsWith('official-');
  const direct = row.source === 'walmart-new';
  badge.className = `tl-tag ${official || direct ? 'tl-tag-official' : 'tl-tag-unconfirmed'}`;
  badge.textContent = official ? 'Official' : direct ? 'New at Walmart' : 'Unconfirmed';
  tags.appendChild(badge);
  if (!official && /^✓ Matches official/.test(row.snippet || '')) {
    const v = document.createElement('span');
    v.className = 'tl-tag tl-tag-official';
    v.textContent = '✓ Matches official';
    tags.appendChild(v);
  }
  if (row.retailer) {
    const r = document.createElement('span');
    r.className = 'tl-tag';
    r.textContent = row.retailer;
    tags.appendChild(r);
  }
  main.appendChild(tags);
  const title = document.createElement('div');
  title.className = 'tl-item-title';
  title.textContent = decode(row.title);
  main.appendChild(title);
  const meta = document.createElement('div');
  meta.className = 'tl-item-meta';
  meta.textContent = `${SOURCE_LABELS[row.source] || row.source} · ${timeAgo(row.discovered_at)}`;
  main.appendChild(meta);
  card.appendChild(main);

  if (row.url) {
    const go = document.createElement('span');
    go.className = 'tl-item-go';
    go.textContent = 'READ →';
    card.appendChild(go);
  }
  return card;
}

function dedupe(rows) {
  const seen = new Set();
  return rows.filter((r) => {
    const k = `${r.source}|${decode(r.title).toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
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
      empty.textContent = 'No tips right now.';
      list.appendChild(empty);
      return;
    }
    for (const row of dedupe(rows)) list.appendChild(renderCard(row));
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
