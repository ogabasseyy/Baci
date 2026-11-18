import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { isEntrypoint } from '../lib/is-entrypoint.mjs';
import {
  CACHE_INVALIDATION_DEAD_LETTER_CODE,
  runWebCron,
} from './run-web-cron.mjs';

const PATH = '/api/cron/drain-cache-invalidations';
const MIN_INTERVAL_MS = 2 * 60_000;
const HEARTBEAT_INTERVAL_MS = 60 * 60_000;
const PRECHECK_TIMEOUT_MS = 5_000;
const STALE_CLAIM_AGE_MS = 2 * 60_000;
const READY_CLOCK_SKEW_MS = 5_000;
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

function resolveSupabaseConfig(env) {
  const supabaseUrl =
    env.SUPABASE_URL?.trim() || env.NEXT_PUBLIC_SUPABASE_URL?.trim() || '';
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }
  return { supabaseUrl, serviceRoleKey };
}

function isHeartbeatDue(state, now) {
  return (
    !Number.isFinite(state.lastWebCronAt) ||
    now < state.lastWebCronAt ||
    now - state.lastWebCronAt >= HEARTBEAT_INTERVAL_MS
  );
}

async function hasActionableOutboxWork({
  supabaseConfig,
  createSupabaseClient,
  now,
  logger,
}) {
  try {
    const supabase = createSupabaseClient(
      supabaseConfig.supabaseUrl,
      supabaseConfig.serviceRoleKey,
      { auth: { persistSession: false } }
    );
    const readyCutoffIso = new Date(now + READY_CLOCK_SKEW_MS).toISOString();
    const staleClaimCutoffIso = new Date(
      now - STALE_CLAIM_AGE_MS
    ).toISOString();
    const filter = [
      `and(status.in.(pending,failed),next_attempt_at.lte.${readyCutoffIso})`,
      `and(status.eq.claimed,claimed_at.lt.${staleClaimCutoffIso})`,
      'status.eq.dead_letter',
    ].join(',');
    const query = supabase
      .from('cache_invalidation_outbox')
      .select('target_id')
      .or(filter)
      .limit(1);
    const { data, error } = await (typeof query.abortSignal === 'function'
      ? query.abortSignal(AbortSignal.timeout(PRECHECK_TIMEOUT_MS))
      : query);
    if (error) {
      logger.warn?.(
        `[drain-cache-invalidations] precheck query failed, failing open: ${error.message}`
      );
      return true;
    }
    if (!Array.isArray(data)) {
      logger.warn?.(
        '[drain-cache-invalidations] precheck returned unexpected payload, failing open'
      );
      return true;
    }
    return data.length > 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn?.(
      `[drain-cache-invalidations] precheck threw, failing open: ${message}`
    );
    return true;
  }
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
  createSupabaseClient = createClient,
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
  const supabaseConfig = resolveSupabaseConfig(env);

  if (supabaseConfig && !isHeartbeatDue(state, now)) {
    const hasWork = await hasActionableOutboxWork({
      supabaseConfig,
      createSupabaseClient,
      now,
      logger,
    });
    if (!hasWork) {
      const nextState = {
        nextAllowedAt: now + MIN_INTERVAL_MS,
        intervalMs: MIN_INTERVAL_MS,
        deadLettersPresent: false,
        lastWebCronAt: state.lastWebCronAt,
      };
      await persistState({
        makeDirectory,
        move,
        state: nextState,
        stateFile,
        write,
      });
      logger.log?.(
        '[drain-cache-invalidations] idle (0 actionable rows), skipped web cron'
      );
      return {
        skipped: true,
        claimed: 0,
        intervalMs: MIN_INTERVAL_MS,
        nextAllowedAt: nextState.nextAllowedAt,
      };
    }
  }

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
      ...(supabaseConfig && Number.isFinite(state.lastWebCronAt)
        ? { lastWebCronAt: state.lastWebCronAt }
        : {}),
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
    logger.warn?.(
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
      ...(supabaseConfig ? { lastWebCronAt: now } : {}),
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
  const nextState = {
    nextAllowedAt: now + intervalMs,
    intervalMs,
    deadLettersPresent,
    ...(supabaseConfig ? { lastWebCronAt: now } : {}),
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
    intervalMs,
    nextAllowedAt: nextState.nextAllowedAt,
  };
}

if (isEntrypoint(import.meta.url)) {
  loadWorkerEnv();
  await runCacheInvalidationCron();
}
