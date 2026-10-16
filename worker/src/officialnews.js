// officialnews.js — 2026-10-16. Official publisher news, read directly
// (no tracker app in between): Wizards of the Coast (MTG), Disney Lorcana
// (Ravensburger) and The Pokémon Company's press site.
//
// Two jobs:
//  1) New official announcement → stored in heads_up as source
//     'official-<game>' and pushed as "✅ Official".
//  2) CROSS-CHECK. Tips from other sources (Restockd, autoqueue, …) stay —
//     but when a tip and an official article name the same product, the
//     tip's push says "✓ matches official news", and a new official article
//     says when it confirms an earlier tip.
//
// Boundary: plain public page reads only. If a page answers with a bot
// check (pokemon.com does — Incapsula), it is skipped, never bypassed.

import { insertHeadsUp } from './db.js';
import { notifyAll } from './push.js';

export const OFFICIAL_SOURCES = [
  {
    key: 'official-mtg', game: 'mtg',
    url: 'https://magic.wizards.com/en/news/announcements',
    base: 'https://magic.wizards.com',
    linkRe: /<a\b[^>]*href="((?:https:\/\/magic\.wizards\.com)?\/en\/news\/announcements\/[a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/gi,
  },
  {
    key: 'official-lorcana', game: 'lorcana',
    url: 'https://www.disneylorcana.com/en-US/news',
    base: 'https://www.disneylorcana.com',
    linkRe: /<a\b[^>]*href="((?:https:\/\/www\.disneylorcana\.com)?\/en-US\/news\/\d{4}\/\d{2}\/[a-z0-9_-]+)"[^>]*>([\s\S]*?)<\/a>/gi,
  },
  {
    key: 'official-pokemon', game: 'pokemon',
    url: 'https://press.pokemon.com/en/releases',
    base: 'https://press.pokemon.com',
    linkRe: /<a\b[^>]*href="((?:https:\/\/press\.pokemon\.com)?\/en\/releases\/[A-Za-z0-9_-]+)"[^>]*>([\s\S]*?)<\/a>/gi,
  },
];

// Only product-ish announcements get pushed (deck guides etc. are skipped).
const PRODUCT_RE = /(release|announc|pre-?order|available|secret lair|superdrop|drop|arriv|launch|collection|box|bundle|deck|expansion|product|gift|trove|prerelease|sale|set\b)/i;
const BOT_WALL_RE = /incapsula|robot or human|are you a human|verify you are human|access denied|pardon our interruption/i;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function strip(html) {
  return String(html).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
function titleFromSlug(path) {
  const slug = path.split('/').pop().replace(/[_-]+/g, ' ');
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

export function parseOfficialList(html, src) {
  const byUrl = new Map();
  const re = new RegExp(src.linkRe.source, 'gi');
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = m[1].startsWith('http') ? m[1] : src.base + m[1];
    const text = strip(m[2]).replace(/^\d{1,2} [A-Z][a-z]+ \d{4}\s*/, '').replace(/\s*Read more\s*$/i, '').slice(0, 160);
    const prev = byUrl.get(url);
    if (!prev || text.length > prev.length) byUrl.set(url, text);
  }
  return [...byUrl.entries()].map(([url, text]) => ({ url, title: text.length >= 6 ? text : titleFromSlug(url) }));
}

// ---- cross-check matching ----
const STOP = new Set(['pokemon', 'pokémon', 'magic', 'gathering', 'disney', 'lorcana', 'trading', 'card', 'cards', 'game',
  'with', 'from', 'your', 'this', 'that', 'into', 'have', 'will', 'more', 'about', 'now', 'available', 'announced',
  'announces', 'release', 'releases', 'notes', 'press', 'expansion', 'collection', 'booster', 'boosters', 'elite',
  'trainer', 'bundle', 'deck', 'decks', 'pack', 'packs', 'drop', 'drops', 'restock', 'walmart', 'target', 'center',
  'today', 'tomorrow', 'arrives', 'coming', 'soon', 'launch', 'launches', 'edition', 'mega', 'evolution', 'signal',
  'unconfirmed', 'stock', 'sale', 'preorder', 'pre-order', 'online', 'store']);
function words(s) {
  return new Set(String(s).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9é ]+/g, ' ').split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)));
}
export function sameProduct(a, b) {
  const A = words(a); const B = words(b);
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared >= 2;
}

// Tip → official article it matches (last 60 days), or null.
export async function findOfficialMatch(env, tipText) {
  const since = new Date(Date.now() - 60 * 86400000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT title, url FROM heads_up WHERE source LIKE 'official-%' AND discovered_at > ? ORDER BY id DESC LIMIT 100`
  ).bind(since).all();
  return results.find((r) => sameProduct(tipText, r.title)) || null;
}

// Official article → earlier tip it confirms (last 14 days), or null.
async function findTipMatch(env, officialTitle) {
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT title, source FROM heads_up WHERE source NOT LIKE 'official-%' AND discovered_at > ? ORDER BY id DESC LIMIT 200`
  ).bind(since).all();
  return results.find((r) => sameProduct(officialTitle, r.title)) || null;
}

async function checkOne(env, src) {
  const res = await fetch(src.url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  const html = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (BOT_WALL_RE.test(html.slice(0, 5000)) && html.length < 20000) throw new Error('bot check page — skipped');
  const items = parseOfficialList(html, src);
  if (!items.length) return 0;

  // First successful read: store everything silently, so the existing
  // archive doesn't arrive as a burst of pushes.
  const seeded = await env.DB.prepare(`SELECT 1 FROM heads_up WHERE source = ? LIMIT 1`).bind(src.key).first();
  const now = new Date().toISOString();
  for (const it of items.slice(0, 30)) {
    const row = { source: src.key, game: src.game, title: it.title, snippet: null, url: it.url, retailer: null, discovered_at: now, dedupe_key: it.url };
    const isNew = await insertHeadsUp(env, row);
    if (!isNew || !seeded || !PRODUCT_RE.test(it.title)) continue;
    const tip = await findTipMatch(env, it.title).catch(() => null);
    await notifyAll(env, {
      title: '✅ Official announcement',
      body: tip ? `${it.title} — confirms an earlier tip` : it.title,
      url: it.url,
      tag: `official-${it.url}`,
    });
  }
  return items.length;
}

export async function runOfficialNews(env) {
  const settled = await Promise.allSettled(OFFICIAL_SOURCES.map((s) => checkOne(env, s)));
  settled.forEach((s, i) => { if (s.status === 'rejected') console.warn(`[official] ${OFFICIAL_SOURCES[i].key}: ${s.reason?.message || s.reason}`); });
}

// For /api/admin/sources-check.
export async function officialSourcesCheck() {
  const out = {};
  await Promise.all(OFFICIAL_SOURCES.map(async (s) => {
    try {
      const r = await fetch(s.url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
      const html = await r.text();
      const items = parseOfficialList(html, s);
      out[s.key] = { status: r.status, bytes: html.length, botWall: BOT_WALL_RE.test(html.slice(0, 5000)) && html.length < 20000, articlesFound: items.length, first: items.slice(0, 3).map((i) => i.title) };
    } catch (err) {
      out[s.key] = { error: err.message };
    }
  }));
  return out;
}
