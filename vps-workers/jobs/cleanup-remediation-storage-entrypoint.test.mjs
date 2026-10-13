import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runRemediationStorageCleanup } from './cleanup-remediation-storage.mjs';

describe('remediation storage cleanup entrypoint', () => {
  it('rotates a .log drain only inside the drain-specific path', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-log-drain-'));
    const drainPath = join(directory, 'vercel-drain.log');
    writeFileSync(drainPath, 'drain-new');

    const result = runRemediationStorageCleanup({
      env: {
        BACI_WORKER_LOG_DIR: directory,
        BACI_WORKER_LOG_MAX_BYTES: '4',
        VERCEL_ERROR_LOG_MAX_BYTES: '4',
        VERCEL_ERROR_LOG_PATH: drainPath,
      },
      logger: { log: () => undefined },
    });

    assert.equal(result.rotatedLogs, 1);
    assert.equal(readFileSync(`${drainPath}.1`, 'utf8'), 'drain-new');
    assert.equal(readFileSync(drainPath, 'utf8'), '');
  });

  it('rotates and prunes drain artifacts in the drain directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'baci-split-storage-'));
    const workerDirectory = join(root, 'worker-logs');
    const drainDirectory = join(root, 'drain');
    mkdirSync(workerDirectory);
    mkdirSync(drainDirectory);
    const drainPath = join(drainDirectory, 'vercel-drain.jsonl');
    writeFileSync(join(workerDirectory, 'worker.log'), 'worker-new');
    const oldArtifact = join(
      drainDirectory,
      'vercel-drain.quarantine-old.jsonl'
    );
    const newArtifact = join(
      drainDirectory,
      'vercel-drain.quarantine-new.jsonl'
    );
    const retainedArtifact = join(
      drainDirectory,
      'vercel-drain.quarantine-retained.jsonl'
    );
    const workerArtifact = join(
      workerDirectory,
      'vercel-drain.quarantine-worker.jsonl'
    );
    writeFileSync(oldArtifact, 'old');
    writeFileSync(newArtifact, 'new');
    writeFileSync(retainedArtifact, 'stale');
    writeFileSync(workerArtifact, 'worker');
    const now = Date.now();
    utimesSync(oldArtifact, (now - 30_000) / 1_000, (now - 30_000) / 1_000);
    utimesSync(newArtifact, (now + 20_000) / 1_000, (now + 20_000) / 1_000);
    utimesSync(
      retainedArtifact,
      (now + 10_000) / 1_000,
      (now + 10_000) / 1_000
    );
    writeFileSync(drainPath, 'drain-new');
    writeFileSync(`${drainPath}.1`, 'drain-old');

    const result = runRemediationStorageCleanup({
      env: {
        BACI_WORKER_LOG_DIR: workerDirectory,
        BACI_WORKER_LOG_MAX_BYTES: '4',
        BACI_WORKER_LOG_MAX_ROTATED_FILES: '1',
        VERCEL_ERROR_LOG_MAX_BYTES: '4',
        VERCEL_ERROR_LOG_MAX_ROTATED_FILES: '4',
        VERCEL_ERROR_LOG_PATH: drainPath,
      },
      logger: { log: () => undefined },
    });

    assert.equal(result.rotatedLogs, 2);
    assert.equal(result.prunedDrainArtifacts, 0);
    assert.equal(readFileSync(`${drainPath}.1`, 'utf8'), 'drain-new');
    assert.equal(readFileSync(`${drainPath}.2`, 'utf8'), 'drain-old');
    assert.equal(readFileSync(drainPath, 'utf8'), '');
    assert.equal(
      readFileSync(join(workerDirectory, 'worker.log.1'), 'utf8'),
      'worker-new'
    );
    assert.equal(statSync(oldArtifact).isFile(), true);
    assert.equal(statSync(newArtifact).isFile(), true);
    assert.equal(statSync(retainedArtifact).isFile(), true);
    assert.equal(statSync(workerArtifact).isFile(), true);
  });

  it('uses the autofix worktree root default when no override is configured', () => {
    const root = mkdtempSync(join(tmpdir(), 'baci-default-worktree-root-'));
    const repoDir = join(root, 'repo');
    const worktreeRoot = join(root, 'baci-remediation-worktrees');
    const orphanStore = join(worktreeRoot, 'orphan-run-pnpm-store');
    mkdirSync(repoDir);
    mkdirSync(orphanStore, { recursive: true });
    const oldTime = Date.now() - 48 * 60 * 60 * 1_000;
    utimesSync(orphanStore, oldTime / 1_000, oldTime / 1_000);

    runRemediationStorageCleanup({
      env: { BACI_REPO_DIR: repoDir },
      logger: { log: () => undefined },
      runner: () => ({
        error: null,
        status: 0,
        stderr: '',
        stdout: `worktree ${repoDir}\n`,
      }),
    });

    assert.throws(() => statSync(orphanStore));
  });

  it('keeps worker-log cleanup in the default logs directory for custom drains', () => {
    const root = mkdtempSync(join(tmpdir(), 'baci-default-worker-logs-'));
    const drainDirectory = join(root, 'drain');
    const workerLog = join(root, 'logs', 'worker.log');
    const drainPath = join(drainDirectory, 'custom-drain.jsonl');
    mkdirSync(drainDirectory, { recursive: true });
    mkdirSync(join(root, 'logs'), { recursive: true });
    writeFileSync(workerLog, 'worker-new');
    writeFileSync(drainPath, 'drain-new');

    const previousCwd = process.cwd();
    process.chdir(root);
    try {
      runRemediationStorageCleanup({
        env: {
          BACI_WORKER_LOG_MAX_BYTES: '4',
          VERCEL_ERROR_LOG_MAX_BYTES: '4',
          VERCEL_ERROR_LOG_PATH: drainPath,
        },
        logger: { log: () => undefined },
      });

      assert.equal(readFileSync(`${workerLog}.1`, 'utf8'), 'worker-new');
      assert.equal(readFileSync(`${drainPath}.1`, 'utf8'), 'drain-new');
    } finally {
      process.chdir(previousCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not retain stores for prunable git worktree records', () => {
    const root = mkdtempSync(join(tmpdir(), 'baci-prunable-worktree-'));
    const repoDir = join(root, 'repo');
    const worktreeRoot = join(root, 'worktrees');
    const prunableWorktree = join(worktreeRoot, 'old-run');
    const orphanStore = join(worktreeRoot, 'old-run-pnpm-store');
    mkdirSync(repoDir);
    mkdirSync(orphanStore, { recursive: true });
    const oldTime = Date.now() - 48 * 60 * 60 * 1_000;
    utimesSync(orphanStore, oldTime / 1_000, oldTime / 1_000);

    try {
      runRemediationStorageCleanup({
        env: {
          BACI_REPO_DIR: repoDir,
          BACI_REMEDIATION_WORKTREE_ROOT: worktreeRoot,
        },
        logger: { log: () => undefined },
        runner: () => ({
          error: null,
          status: 0,
          stderr: '',
          stdout: [
            `worktree ${repoDir}`,
            'HEAD main-head',
            'branch refs/heads/main',
            '',
            `worktree ${prunableWorktree}`,
            'HEAD old-head',
            'prunable gitdir file points to non-existent location',
            '',
          ].join('\n'),
        }),
      });

      assert.throws(() => statSync(orphanStore));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
