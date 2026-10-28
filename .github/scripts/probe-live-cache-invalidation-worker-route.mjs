#!/usr/bin/env node
const PREFLIGHT_URL = 'https://ogabassey.com/api/cron/drain-cache-invalidations?preflight=1';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function probeLiveCacheInvalidationWorkerRoute({
  cronSecret,
  fetchImpl = fetch,
  attempts = 10,
  retryDelayMs = 2_000,
  requestTimeoutMs = 15_000,
} = {}) {
  if (typeof cronSecret !== 'string' || cronSecret.length < 1 ||
      !Number.isSafeInteger(attempts) || attempts < 1 ||
      !Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0 ||
      !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1) {
    throw new Error('cache worker runtime preflight configuration is invalid');
  }
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(PREFLIGHT_URL, {
        method: 'GET',
        redirect: 'error',
        headers: { authorization: `Bearer ${cronSecret}` },
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (response.status === 200) {
        const payload = await response.json();
        if (payload && typeof payload === 'object' && !Array.isArray(payload) &&
            payload.ready === true && Object.keys(payload).length === 1) {
          return { attempts: attempt, ready: true };
        }
      }
    } catch {
      // The endpoint can be briefly unavailable while the alias propagates.
      // Never include response bodies, fetch errors, or the cron secret in logs.
    }
    if (attempt < attempts) await sleep(retryDelayMs);
  }
  throw new Error('live cache invalidation worker preflight did not pass; production rollback is required');
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  probeLiveCacheInvalidationWorkerRoute({ cronSecret: process.env.CRON_SECRET }).then((receipt) => {
    process.stdout.write(`Live cache invalidation worker preflight passed after ${receipt.attempts} attempt(s).\n`);
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
