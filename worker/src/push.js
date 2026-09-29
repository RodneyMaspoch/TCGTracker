// push.js — Web Push (VAPID) on Workers. The Node version used the
// `web-push` npm package, which leans on Node's `crypto`/`https` modules and
// isn't supported on Cloudflare Workers (see web-push-libs/web-push#718).
// This uses @block65/webcrypto-web-push instead — same RFC 8291 (aes128gcm
// encryption) / RFC 8292 (VAPID) protocol, implemented purely on the Web
// Crypto API, explicitly built to run on Workers. Your existing VAPID keys
// (from `npm run generate-vapid` in the Node version) are the same
// base64url format this library expects — no need to regenerate them.
import { buildPushPayload } from '@block65/webcrypto-web-push';
import { allSubscriptions, removeSubscription } from './db.js';

export function pushConfigured(env) {
  return !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

function vapidFrom(env) {
  return {
    subject: env.VAPID_SUBJECT || 'mailto:admin@example.com',
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };
}

// Sends `payload` (title/body/url/tag) to every saved subscriber. Prunes
// subscriptions the push service reports as gone (404/410 — the user
// uninstalled the PWA or revoked permission) — same behavior as the Node
// version's notifyAll.
export async function notifyAll(env, payload) {
  if (!pushConfigured(env)) {
    console.warn('[push] Skipped notifyAll — VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not set.', payload);
    return;
  }
  const vapid = vapidFrom(env);
  const subs = await allSubscriptions(env);
  const message = { data: payload, options: { ttl: 3600 } };

  await Promise.all(subs.map(async (sub) => {
    try {
      const built = await buildPushPayload(message, sub, vapid);
      const res = await fetch(sub.endpoint, built);
      if (res.status === 404 || res.status === 410) {
        await removeSubscription(env, sub.endpoint);
      } else if (!res.ok) {
        console.error('[push] send failed:', res.status, await res.text().catch(() => ''));
      }
    } catch (err) {
      console.error('[push] send threw:', err.message);
    }
  }));
}
