// site-nav.js — a persistent top bar with real links to all four pages
// (MTG, Lorcana, Pokémon, Heads Up). index.html and lorcana.html had NO
// way to get to each other or to Pokémon at all before this — the only
// thing that looked like cross-page nav was a dropdown of same-page
// #anchor jump links. Injected as a plain DOM element outside the
// runtime.js-rendered template (same reasoning as push-client.js's
// floating button) so it can't be broken by, or interfere with, that
// template's own re-rendering.
(function () {
  const path = location.pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
  const current = path === '/' ? 'mtg' : path.replace(/^\//, '');

  const TABS = [
    { key: 'mtg', label: 'MTG', href: '/' },
    { key: 'lorcana', label: 'Lorcana', href: '/lorcana' },
    { key: 'pokemon', label: 'Pokémon', href: '/pokemon' },
    { key: 'heads-up', label: '🔔 Heads Up', href: '/heads-up' },
  ];

  const bar = document.createElement('div');
  Object.assign(bar.style, {
    position: 'sticky',
    top: '0',
    zIndex: '85',
    display: 'flex',
    gap: '6px',
    padding: '10px 14px',
    background: 'rgba(8,8,10,.92)',
    backdropFilter: 'blur(10px)',
    borderBottom: '1px solid rgba(255,255,255,.12)',
    fontFamily: "'Roboto Mono', monospace",
    fontSize: '13px',
    flexWrap: 'wrap',
  });

  for (const tab of TABS) {
    const a = document.createElement('a');
    a.href = tab.href;
    a.textContent = tab.label;
    const active = tab.key === current;
    Object.assign(a.style, {
      textDecoration: 'none',
      padding: '7px 14px',
      borderRadius: '999px',
      color: active ? '#0b0d10' : '#e9e6df',
      background: active ? '#e9e6df' : 'transparent',
      border: '1px solid rgba(255,255,255,.2)',
      fontWeight: active ? '700' : '500',
    });
    bar.appendChild(a);
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.body.insertBefore(bar, document.body.firstChild);
  });
})();
