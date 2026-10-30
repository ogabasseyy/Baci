import { dirname, join } from 'node:path';
import {
  DEFAULT_DRAIN_MAX_BYTES,
  DEFAULT_DRAIN_MAX_ROTATED_FILES,
} from '../lib/vercel-error-events-limits.mjs';
import { cleanupRemediationStorage } from './cleanup-remediation-storage-core.mjs';
import { isEntrypoint } from '../lib/is-entrypoint.mjs';

const DEFAULT_ORPHAN_STORE_RETENTION_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_WORKER_LOG_DIR = 'logs';

function readPositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function runRemediationStorageCleanup({
  env = process.env,
  logger = console,
  runner,
} = {}) {
  const drainPath = env.VERCEL_ERROR_LOG_PATH || 'logs/vercel-drain.jsonl';
  const repoDir = env.BACI_REPO_DIR;
  const worktreeRoot =
    env.BACI_REMEDIATION_WORKTREE_ROOT ||
    (repoDir
      ? join(dirname(repoDir), 'baci-remediation-worktrees')
      : undefined);
  const result = cleanupRemediationStorage({
    logsDir: env.BACI_WORKER_LOG_DIR || DEFAULT_WORKER_LOG_DIR,
    drainDir: dirname(drainPath),
    drainPath,
    maxLogBytes: readPositiveInt(
      env.BACI_WORKER_LOG_MAX_BYTES,
      DEFAULT_DRAIN_MAX_BYTES
    ),
    maxRotatedLogs: readPositiveInt(
      env.BACI_WORKER_LOG_MAX_ROTATED_FILES,
      DEFAULT_DRAIN_MAX_ROTATED_FILES
    ),
    maxDrainLogBytes: readPositiveInt(
      env.VERCEL_ERROR_LOG_MAX_BYTES,
      DEFAULT_DRAIN_MAX_BYTES
    ),
    maxDrainRotatedLogs: readPositiveInt(
      env.VERCEL_ERROR_LOG_MAX_ROTATED_FILES,
      DEFAULT_DRAIN_MAX_ROTATED_FILES
    ),
    orphanStoreRetentionMs:
      readPositiveInt(
        env.BACI_REMEDIATION_ORPHAN_STORE_RETENTION_HOURS,
        DEFAULT_ORPHAN_STORE_RETENTION_MS / (60 * 60 * 1_000)
      ) *
      60 *
      60 *
      1_000,
    repoDir,
    runner,
    worktreeRoot,
  });
  logger.log(
    JSON.stringify({ type: 'remediation_storage_cleanup', ...result })
  );
  return result;
}

if (
  isEntrypoint(import.meta.url)
) {
  const { config } = await import('dotenv');
  config({ path: new URL('../.env', import.meta.url) });
  try {
    runRemediationStorageCleanup();
  } catch (error) {
    console.error('[remediation-storage-cleanup] failed:', error);
    process.exitCode = 1;
  }
}
