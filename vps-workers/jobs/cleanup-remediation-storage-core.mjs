import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { withDrainFileLock } from '../lib/drain-file-lock.mjs';
import {
  DEFAULT_DRAIN_MAX_BYTES,
  DEFAULT_DRAIN_MAX_ROTATED_FILES,
} from '../lib/vercel-error-events-limits.mjs';

const DEFAULT_ORPHAN_STORE_RETENTION_MS = 24 * 60 * 60 * 1_000;

function readPositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function drainArtifactPatterns(drainPath) {
  const drainName = basename(drainPath);
  const drainStem = drainName.endsWith('.jsonl')
    ? drainName.slice(0, -'.jsonl'.length)
    : drainName;
  return {
    quarantine: new RegExp(
      `^${escapeRegExp(drainStem)}\\.quarantine-.*\\.jsonl(?:\\.gz)?$`
    ),
    rotation: new RegExp(`^${escapeRegExp(drainName)}\\.(\\d+)(?:\\.gz)?$`),
  };
}

function rotateFile(filePath, maxBytes, maxRotatedLogs) {
  let entries;
  try {
    entries = readdirSync(dirname(filePath), { withFileTypes: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    entries = [];
  }
  const rotationPattern = new RegExp(
    `^${escapeRegExp(basename(filePath))}\\.(\\d+)(?:\\.gz)?$`
  );
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    const match = rotationPattern.exec(entry.name);
    if (match && Number(match[1]) > maxRotatedLogs) {
      rmSync(join(dirname(filePath), entry.name), { force: true });
    }
  }

  let size;
  try {
    size = statSync(filePath).size;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  if (size <= maxBytes) return false;

  for (let index = maxRotatedLogs; index >= 1; index -= 1) {
    const source = index === 1 ? filePath : `${filePath}.${index - 1}`;
    const destination = `${filePath}.${index}`;
    try {
      renameSync(source, destination);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return true;
}

function listRegisteredWorktrees({ repoDir, runner = spawnSync }) {
  if (!repoDir) return null;
  const result = runner(
    'git',
    ['-C', repoDir, 'worktree', 'list', '--porcelain'],
    {
      encoding: 'utf8',
      shell: false,
    }
  );
  if (result.error || result.status !== 0) return null;
  const registered = new Set();
  let worktreePath;
  let prunable = false;
  const finishRecord = () => {
    if (worktreePath && !prunable) {
      registered.add(resolve(worktreePath));
    }
    worktreePath = undefined;
    prunable = false;
  };
  for (const line of (result.stdout || '').split(/\r?\n/)) {
    if (!line) {
      finishRecord();
      continue;
    }
    if (line.startsWith('worktree ')) {
      finishRecord();
      worktreePath = line.slice('worktree '.length);
      continue;
    }
    if (line.startsWith('prunable')) prunable = true;
  }
  finishRecord();
  return registered;
}

function cleanupOrphanedStores({
  now,
  registeredWorktrees,
  retentionMs,
  worktreeRoot,
}) {
  if (!registeredWorktrees || !worktreeRoot) return 0;
  const resolvedRoot = resolve(worktreeRoot);
  if (!existsSync(resolvedRoot)) return 0;
  let removed = 0;
  for (const entry of readdirSync(resolvedRoot, { withFileTypes: true })) {
    if (!entry.name.endsWith('-pnpm-store')) continue;
    const storePath = join(resolvedRoot, entry.name);
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const worktreeName = entry.name.slice(0, -'-pnpm-store'.length);
    const worktreePath = join(resolvedRoot, worktreeName);
    if (registeredWorktrees.has(resolve(worktreePath))) continue;
    let age;
    try {
      age = now - statSync(storePath).mtimeMs;
    } catch {
      continue;
    }
    if (age < retentionMs) continue;
    rmSync(storePath, { force: true, recursive: true });
    removed += 1;
  }
  return removed;
}

function cleanupOldDrainArtifacts({ drainDir, drainPath, maxRotatedLogs }) {
  const { quarantine, rotation } = drainArtifactPatterns(drainPath);
  if (!existsSync(drainDir)) return 0;
  const removeExcess = (pattern) => {
    const artifacts = readdirSync(drainDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && pattern.test(entry.name))
      .map((entry) => {
        const path = join(drainDir, entry.name);
        return { path, mtimeMs: statSync(path).mtimeMs };
      })
      .sort((left, right) => right.mtimeMs - left.mtimeMs);
    let removed = 0;
    for (const artifact of artifacts.slice(maxRotatedLogs)) {
      rmSync(artifact.path, { force: true });
      removed += 1;
    }
    return removed;
  };
  return removeExcess(rotation) + removeExcess(quarantine);
}

export function cleanupRemediationStorage({
  logsDir = 'logs',
  drainDir: configuredDrainDir,
  maxLogBytes = DEFAULT_DRAIN_MAX_BYTES,
  maxRotatedLogs = DEFAULT_DRAIN_MAX_ROTATED_FILES,
  maxDrainLogBytes = maxLogBytes,
  maxDrainRotatedLogs = maxRotatedLogs,
  drainPath: configuredDrainPath,
  now = Date.now(),
  orphanStoreRetentionMs = DEFAULT_ORPHAN_STORE_RETENTION_MS,
  registeredWorktrees,
  repoDir,
  runner,
  worktreeRoot,
} = {}) {
  const normalizedMaxRotatedLogs = readPositiveInt(
    maxRotatedLogs,
    DEFAULT_DRAIN_MAX_ROTATED_FILES
  );
  const normalizedMaxDrainRotatedLogs = readPositiveInt(
    maxDrainRotatedLogs,
    DEFAULT_DRAIN_MAX_ROTATED_FILES
  );
  const normalizedMaxLogBytes = readPositiveInt(
    maxLogBytes,
    DEFAULT_DRAIN_MAX_BYTES
  );
  const normalizedMaxDrainLogBytes = readPositiveInt(
    maxDrainLogBytes,
    DEFAULT_DRAIN_MAX_BYTES
  );
  const drainPath =
    configuredDrainPath ||
    join(configuredDrainDir ?? logsDir, 'vercel-drain.jsonl');
  const drainDir = configuredDrainDir ?? dirname(drainPath);
  const resolvedDrainPath = resolve(drainPath);
  let rotatedLogs = 0;
  if (existsSync(logsDir)) {
    for (const entry of readdirSync(logsDir, { withFileTypes: true })) {
      if (
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        !entry.name.endsWith('.log')
      ) {
        continue;
      }
      if (resolve(join(logsDir, entry.name)) === resolvedDrainPath) {
        continue;
      }
      if (
        rotateFile(
          join(logsDir, entry.name),
          normalizedMaxLogBytes,
          normalizedMaxRotatedLogs
        )
      ) {
        rotatedLogs += 1;
      }
    }
  }
  let prunedDrainArtifacts = 0;
  withDrainFileLock(`${drainPath}.lock`, () => {
    if (
      rotateFile(
        drainPath,
        normalizedMaxDrainLogBytes,
        normalizedMaxDrainRotatedLogs
      )
    ) {
      // Keep the receiver's active path available even when no request arrives
      // before the next remediator tick.
      writeFileSync(drainPath, '', { flag: 'a', mode: 0o600 });
      rotatedLogs += 1;
    }
    prunedDrainArtifacts = cleanupOldDrainArtifacts({
      drainDir,
      drainPath,
      maxRotatedLogs: normalizedMaxDrainRotatedLogs,
    });
  });
  const worktrees =
    registeredWorktrees ?? listRegisteredWorktrees({ repoDir, runner });
  return {
    orphanedStores: cleanupOrphanedStores({
      now,
      registeredWorktrees: worktrees,
      retentionMs: orphanStoreRetentionMs,
      worktreeRoot,
    }),
    prunedDrainArtifacts,
    rotatedLogs,
  };
}
