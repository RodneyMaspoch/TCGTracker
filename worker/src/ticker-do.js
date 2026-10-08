// ticker-do.js — a single Durable Object instance that runs tick() on a
// true ~15s loop, instead of waiting on Cloudflare's Cron Trigger floor.
//
// Why this exists: Cron Triggers (see wrangler.toml's [triggers] block)
// cannot fire more often than once a minute (`* * * * *`) on ANY Workers
// plan — that's a hard platform limit, not a setting. Durable Object
// alarms aren't bound by that limit: an alarm can be set for any future
// timestamp, including a few seconds out, so a DO that re-arms its own
// alarm every time it fires can run a loop as tight as 15s (or faster)
// while staying entirely on Cloudflare — no second server, no new bill
// for most workloads (see the cost comment below).
//
// How it works: alarm() runs tick() (the exact same fast/slow/heads-up
// sweep that used to run from the Cron Trigger directly), then
// immediately re-arms itself for now+TICK_INTERVAL_MS. The `finally`
// block guarantees the re-arm happens even if tick() throws — a missed
// re-arm here would silently stop the entire polling pipeline, which is
// exactly the failure mode the rest of this codebase goes out of its way
// to avoid (see poll.js's own extensive comments on the same theme).
//
// Self-healing: a self-perpetuating alarm chain has one real failure
// mode — if something causes the DO to stop re-arming (an uncaught error
// before the finally block could somehow be bypassed, platform-level DO
// eviction/reset, etc.), nothing would ever restart it on its own. The
// existing once-a-minute Cron Trigger (now repurposed, see index.js's
// `scheduled()` handler) is kept specifically as a cheap watchdog for
// this: every minute it pings this DO's fetch() handler, which checks
// `storage.getAlarm()` and only arms a new alarm if one isn't already
// scheduled. In normal operation this is a no-op every single time; it
// only does real work in the rare case the 15s loop has actually broken,
// and even then the gap is capped at ~60s, not permanent.
//
// Cost model shift: a plain Worker invocation bills CPU time only — time
// spent awaiting fetch() is free (see poll.js's header comment). Durable
// Objects bill differently: requests/alarm-invocations count against the
// request quota, and wall-clock time the object is active counts as
// duration (GB-seconds), not just CPU time. At 15s intervals that's
// ~5,760 alarm firings/day — far under the free plan's 100,000
// requests/day — and each firing is only active for the few hundred ms
// it takes to await this round's fetches, so daily duration use should
// stay a small fraction of the free plan's 13,000 GB-seconds/day. Retune
// TICK_INTERVAL_MS below if actual usage ever gets close to either limit.
//
// Trade-off worth knowing: running tick() 4x more often (every 15s
// instead of every 60s) also means 4x more HTTP requests landing on the
// actual retailer pages being scraped (Target, Walmart, Best Buy,
// GameStop, etc.) over the course of a day. That's the real cost of
// faster checking — if any retailer's bot-detection starts responding
// differently (CAPTCHAs, 403s, blocks), raising TICK_INTERVAL_MS back up
// is the first thing to try.
import { tick } from './poll.js';

const TICK_INTERVAL_MS = 15000; // 15 seconds — see header comment

export class Ticker {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  // Heartbeat entrypoint, called once a minute from index.js's scheduled()
  // handler. Only acts if the self-perpetuating alarm loop has somehow
  // stopped — see header comment.
  async fetch(_request) {
    const existing = await this.ctx.storage.getAlarm();
    if (existing == null) {
      console.warn('[ticker] no alarm currently scheduled — arming now (self-heal)');
      await this.ctx.storage.setAlarm(Date.now() + TICK_INTERVAL_MS);
    }
    return new Response('ok');
  }

  async alarm() {
    try {
      await tick(this.env);
    } catch (err) {
      // tick() already isolates failures internally (see poll.js), so
      // reaching here means something outside that isolation went wrong
      // (e.g. getPollState/setPollState itself, or a bug in tick() code
      // added later). Either way: log it, but never let it skip the
      // re-arm below — a silently-stopped loop is worse than one noisy
      // failed cycle.
      console.error('[ticker] tick() failed inside alarm():', err);
    } finally {
      await this.ctx.storage.setAlarm(Date.now() + TICK_INTERVAL_MS);
    }
  }
}
