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
  reddit: 'Reddit — r/PokemonTCG',
};

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

function renderCard(row) {
  const card = document.createElement('div');
  card.className = 'headsup-card';

  const top = document.createElement('div');
  top.className = 'headsup-top';
  const badge = document.createElement('span');
  badge.className = 'headsup-badge';
  badge.textContent = 'UNCONFIRMED';
  top.appendChild(badge);
  if (row.game) {
    const chip = document.createElement('span');
    chip.className = 'headsup-game-chip';
    chip.textContent = GAME_LABELS[row.game] || row.game;
    top.appendChild(chip);
  }
  card.appendChild(top);

  const title = document.createElement('div');
  title.className = 'headsup-title';
  title.textContent = row.title;
  card.appendChild(title);

  if (row.snippet && row.snippet !== row.title) {
    const snippet = document.createElement('div');
    snippet.className = 'headsup-snippet';
    snippet.textContent = `"${row.snippet}"`;
    card.appendChild(snippet);
  }

  const meta = document.createElement('div');
  meta.className = 'headsup-meta';
  const source = document.createElement('span');
  source.className = 'headsup-source';
  source.textContent = `${SOURCE_LABELS[row.source] || row.source} · ${timeAgo(row.discovered_at)}`;
  meta.appendChild(source);
  if (row.url) {
    const link = document.createElement('a');
    link.className = 'headsup-link';
    link.href = row.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'View source →';
    meta.appendChild(link);
  }
  card.appendChild(meta);

  return card;
}

async function load() {
  try {
    const rows = await fetch('/api/heads-up?limit=50').then((r) => r.json());
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
  }
}

(async function init() {
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('/sw.js'); } catch (err) { console.error('[heads-up] sw register failed', err); }
  }
  await load();
  setInterval(load, REFRESH_MS);
})();
