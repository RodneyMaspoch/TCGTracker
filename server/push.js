// push.js — Web Push (VAPID) wiring. Works for Chrome/Edge/Firefox on
// desktop + Android out of the box, and for Safari on iOS 16.4+ *once the
// PWA has been added to the Home Screen* (Safari push does not work for a
// plain browser tab, only for the installed app).
const webpush = require('web-push');
const db = require('./db');

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

let configured = false;
if (PUBLIC_KEY && PRIVATE_KEY) {
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
  configured = true;
} else {
  console.warn('[push] VAPID keys not set — run `npm run generate-vapid` and set the env vars. Push notifications are disabled until then.');
}

const insertSub = db.prepare(`
  INSERT INTO push_subscriptions (endpoint, subscription_json, created_at)
  VALUES (@endpoint, @subscription_json, @created_at)
  ON CONFLICT(endpoint) DO UPDATE SET subscription_json=excluded.subscription_json
`);
const deleteSub = db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`);
const allSubs = db.prepare(`SELECT * FROM push_subscriptions`);

function saveSubscription(sub) {
  insertSub.run({
    endpoint: sub.endpoint,
    subscription_json: JSON.stringify(sub),
    created_at: new Date().toISOString(),
  });
}

function removeSubscription(endpoint) {
  deleteSub.run(endpoint);
}

// Sends `payload` (a plain object — title/body/url/tag) to every saved
// subscriber. Prunes subscriptions the push service reports as gone
// (410/404 — the user uninstalled the PWA or revoked permission).
async function notifyAll(payload) {
  if (!configured) {
    console.warn('[push] Skipped notifyAll — VAPID not configured.', payload);
    return;
  }
  const subs = allSubs.all();
  const body = JSON.stringify(payload);
  await Promise.all(subs.map(async (row) => {
    const sub = JSON.parse(row.subscription_json);
    try {
      await webpush.sendNotification(sub, body);
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        removeSubscription(row.endpoint);
      } else {
        console.error('[push] send failed:', err.statusCode, err.body);
      }
    }
  }));
}

module.exports = { saveSubscription, removeSubscription, notifyAll, PUBLIC_KEY, configured };
