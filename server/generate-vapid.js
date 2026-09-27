// One-time helper: run `npm run generate-vapid` and paste the output into
// your .env (local) or your host's environment variables (Railway/Fly/Render).
// These keys identify *your* server to the browser push services (FCM,
// Mozilla autopush, Apple's web push service) — generate them once and
// reuse them forever; regenerating invalidates every existing subscription.
const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();
console.log('\nAdd these to your environment (.env locally, or your host\'s dashboard):\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`VAPID_SUBJECT=mailto:you@example.com\n`);
