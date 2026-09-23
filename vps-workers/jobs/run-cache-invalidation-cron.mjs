import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import {
  CACHE_INVALIDATION_DEAD_LETTER_CODE,
  runWebCron,
} from './run-web-cron.mjs';

const PATH = '/api/cron/drain-cache-invalidations';
const MIN_INTERVAL_MS = 2 * 60_000;
// Keep discovery bounded by the existing two-minute cron while no durable
// queue wake signal is available. Backoff would strand newly enqueued work.

export function loadWorkerEnv(loader = config) {
  loader({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
}

function parseState(raw) {
  try {
    const value = JSON.parse(raw);
    if (
      Number.isFinite(value.nextAllowedAt) &&
      Number.isFinite(value.intervalMs)
    ) {
      return value;
    }
  } catch {
    // Corrupt local state is equivalent to a cold start.
  }
  return { nextAllowedAt: 0, intervalMs: MIN_INTERVAL_MS };
}

async function persistState({ makeDirectory, move, state, stateFile, write }) {
  await makeDirectory(dirname(stateFile), { recursive: true });
  const temporaryFile = `${stateFile}.${process.pid}.tmp`;
  await write(temporaryFile, JSON.stringify(state), { mode: 0o600 });
  await move(temporaryFile, stateFile);
}

export async function runCacheInvalidationCron({
  env = process.env,
  now = Date.now(),
  run = runWebCron,
  read = readFile,
  write = writeFile,
  move = rename,
  makeDirectory = mkdir,
  logger = console,
} = {}) {
  const stateFile =
    env.CACHE_INVALIDATION_STATE_FILE ||
    '/tmp/baci-cache-invalidations-state.json';
  const state = parseState(await read(stateFile, 'utf8').catch(() => ''));
  let result;
  try {
    result = await run({
      path: PATH,
      env,
      logger,
      allowCacheDeadLetter: true,
    });
  } catch (error) {
    // Preserve a short retry cadence for alerts/transient failures.
    const retryMs = MIN_INTERVAL_MS;
    const nextState = {
      nextAllowedAt: now + retryMs,
      intervalMs: retryMs,
      deadLettersPresent: state.deadLettersPresent === true,
    };
    await persistState({
      makeDirectory,
      move,
      state: nextState,
      stateFile,
      write,
    });
    throw error;
  }

  let payload = {};
  try {
    payload = JSON.parse(result.body);
  } catch {
    /* treat unknown 2xx body as work */
  }
  const deadLettersPresent =
    payload.deadLettersPresent === true || result.cacheDeadLetter === true;
  const claimed = Number(payload.claimed) || 0;
  const newlyObservedDeadLetters =
    deadLettersPresent && state.deadLettersPresent !== true;
  if (newlyObservedDeadLetters) {
    const intervalMs = MIN_INTERVAL_MS;
    logger.warn(
      JSON.stringify({
        event: CACHE_INVALIDATION_DEAD_LETTER_CODE,
        intervalMs,
        nextAllowedAt: now + intervalMs,
      })
    );
    const nextState = {
      nextAllowedAt: now + intervalMs,
      intervalMs,
      deadLettersPresent: true,
    };
    await persistState({
      makeDirectory,
      move,
      state: nextState,
      stateFile,
      write,
    });
    return {
      skipped: false,
      claimed,
      deadLetter: true,
      intervalMs,
      nextAllowedAt: nextState.nextAllowedAt,
    };
  }
  const intervalMs = MIN_INTERVAL_MS;
  const nextState = { nextAllowedAt: now + intervalMs, intervalMs };
  nextState.deadLettersPresent = deadLettersPresent;
  await persistState({
    makeDirectory,
    move,
    state: nextState,
    stateFile,
    write,
  });
  return {
    skipped: false,
    claimed,
    intervalMs,
    nextAllowedAt: nextState.nextAllowedAt,
  };
}

if (process.argv[1]?.endsWith('run-cache-invalidation-cron.mjs')) {
  loadWorkerEnv();
  await runCacheInvalidationCron();
}
