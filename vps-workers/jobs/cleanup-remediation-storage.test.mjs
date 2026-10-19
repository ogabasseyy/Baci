import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { cleanupRemediationStorage } from './cleanup-remediation-storage-core.mjs';

describe('remediation storage cleanup', () => {
  it('rotates worker logs before they grow without bound', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-storage-'));
    writeFileSync(join(directory, 'worker.log'), 'new'.repeat(20));
    writeFileSync(join(directory, 'worker.log.1'), 'older');
    writeFileSync(join(directory, 'worker.log.2'), 'oldest');

    const result = cleanupRemediationStorage({
      logsDir: directory,
      maxLogBytes: 8,
      maxRotatedLogs: 2,
      registeredWorktrees: new Set(),
    });

    assert.equal(result.rotatedLogs, 1);
    assert.equal(
      readFileSync(join(directory, 'worker.log.1'), 'utf8'),
      'new'.repeat(20)
    );
    assert.equal(
      readFileSync(join(directory, 'worker.log.2'), 'utf8'),
      'older'
    );
    assert.equal(statSync(join(directory, 'worker.log.2')).isFile(), true);
  });

  it('removes worker rotations above the configured retention limit', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-worker-retention-'));
    writeFileSync(join(directory, 'worker.log'), 'current');
    writeFileSync(join(directory, 'worker.log.3'), 'orphaned');

    cleanupRemediationStorage({
      logsDir: directory,
      maxRotatedLogs: 2,
      registeredWorktrees: new Set(),
    });

    assert.throws(() => statSync(join(directory, 'worker.log.3')));
  });

  it('removes only old orphaned pnpm stores outside registered worktrees', () => {
    const root = mkdtempSync(join(tmpdir(), 'baci-worktrees-'));
    const worktreeRoot = join(root, 'worktrees');
    mkdirSync(worktreeRoot);
    const orphanStore = join(worktreeRoot, 'old-run-pnpm-store');
    const retainedStore = join(worktreeRoot, 'retained-run-pnpm-store');
    mkdirSync(orphanStore);
    mkdirSync(retainedStore);
    const oldTime = Date.now() - 48 * 60 * 60 * 1_000;
    utimesSync(orphanStore, oldTime / 1_000, oldTime / 1_000);
    utimesSync(retainedStore, oldTime / 1_000, oldTime / 1_000);

    const result = cleanupRemediationStorage({
      now: Date.now(),
      orphanStoreRetentionMs: 24 * 60 * 60 * 1_000,
      registeredWorktrees: new Set([join(worktreeRoot, 'retained-run')]),
      worktreeRoot,
    });

    assert.equal(result.orphanedStores, 1);
    assert.equal(statSync(retainedStore).isDirectory(), true);
    assert.throws(() => statSync(orphanStore));
  });

  it('prunes excess drain quarantine artifacts but keeps recent evidence', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-drain-artifacts-'));
    const oldArtifact = join(directory, 'vercel-drain.quarantine-old.jsonl');
    const newArtifact = join(directory, 'vercel-drain.quarantine-new.jsonl');
    const staleRotation = join(directory, 'vercel-drain.jsonl.3.gz');
    writeFileSync(oldArtifact, 'old');
    writeFileSync(newArtifact, 'new');
    writeFileSync(staleRotation, 'stale');
    const now = Date.now();
    utimesSync(oldArtifact, (now - 10_000) / 1_000, (now - 10_000) / 1_000);
    utimesSync(newArtifact, now / 1_000, now / 1_000);
    utimesSync(staleRotation, (now - 20_000) / 1_000, (now - 20_000) / 1_000);

    const result = cleanupRemediationStorage({
      logsDir: directory,
      maxRotatedLogs: 1,
      registeredWorktrees: new Set(),
    });

    assert.equal(result.prunedDrainArtifacts, 1);
    assert.equal(statSync(newArtifact).isFile(), true);
    assert.throws(() => statSync(oldArtifact));
    assert.throws(() => statSync(staleRotation));
  });

  it('keeps drain rotation retention independent from worker-log retention', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-drain-retention-'));
    writeFileSync(join(directory, 'worker.log'), 'new'.repeat(20));
    writeFileSync(join(directory, 'worker.log.1'), 'older');
    writeFileSync(join(directory, 'vercel-drain.jsonl'), 'drain-new'.repeat(4));
    writeFileSync(join(directory, 'vercel-drain.jsonl.1'), 'drain-old');
    writeFileSync(join(directory, 'vercel-drain.jsonl.2'), 'drain-oldest');

    cleanupRemediationStorage({
      logsDir: directory,
      maxDrainLogBytes: 8,
      maxDrainRotatedLogs: 2,
      maxLogBytes: 8,
      maxRotatedLogs: 1,
      registeredWorktrees: new Set(),
    });

    assert.equal(
      readFileSync(join(directory, 'worker.log.1'), 'utf8'),
      'new'.repeat(20)
    );
    assert.throws(() => statSync(join(directory, 'worker.log.2')));
    assert.equal(
      readFileSync(join(directory, 'vercel-drain.jsonl.2'), 'utf8'),
      'drain-old'
    );
  });

  it('derives custom drain artifact names and retains rotations separately', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-custom-drain-'));
    const drainPath = join(directory, 'custom-drain.jsonl');
    const rotationOne = `${drainPath}.1`;
    const rotationTwo = `${drainPath}.2`;
    const rotationThree = `${drainPath}.3`;
    const oldQuarantine = join(directory, 'custom-drain.quarantine-old.jsonl');
    const middleQuarantine = join(
      directory,
      'custom-drain.quarantine-middle.jsonl'
    );
    const newQuarantine = join(directory, 'custom-drain.quarantine-new.jsonl');
    writeFileSync(drainPath, 'current');
    writeFileSync(rotationOne, 'one');
    writeFileSync(rotationTwo, 'two');
    writeFileSync(rotationThree, 'three');
    writeFileSync(oldQuarantine, 'old');
    writeFileSync(middleQuarantine, 'middle');
    writeFileSync(newQuarantine, 'new');
    const now = Date.now();
    utimesSync(oldQuarantine, (now - 30_000) / 1_000, (now - 30_000) / 1_000);
    utimesSync(
      middleQuarantine,
      (now - 20_000) / 1_000,
      (now - 20_000) / 1_000
    );
    utimesSync(newQuarantine, (now - 10_000) / 1_000, (now - 10_000) / 1_000);

    const result = cleanupRemediationStorage({
      drainDir: directory,
      drainPath,
      maxDrainRotatedLogs: 2,
      registeredWorktrees: new Set(),
    });

    assert.equal(result.prunedDrainArtifacts, 1);
    assert.equal(statSync(rotationOne).isFile(), true);
    assert.equal(statSync(rotationTwo).isFile(), true);
    assert.throws(() => statSync(rotationThree));
    assert.throws(() => statSync(oldQuarantine));
    assert.equal(statSync(middleQuarantine).isFile(), true);
    assert.equal(statSync(newQuarantine).isFile(), true);
  });

  it('prunes custom drain artifacts beside a drain path without a directory override', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-derived-drain-dir-'));
    const drainPath = join(directory, 'custom-drain.jsonl');
    const staleRotation = `${drainPath}.3`;
    const staleQuarantines = ['old', 'middle', 'new'].map((label) =>
      join(directory, `custom-drain.quarantine-${label}.jsonl`)
    );
    writeFileSync(drainPath, 'current');
    writeFileSync(staleRotation, 'stale');
    for (const quarantinePath of staleQuarantines) {
      writeFileSync(quarantinePath, 'stale');
    }

    const result = cleanupRemediationStorage({
      drainPath,
      maxDrainRotatedLogs: 2,
      registeredWorktrees: new Set(),
    });

    assert.equal(result.prunedDrainArtifacts, 1);
    assert.throws(() => statSync(staleRotation));
    assert.equal(
      staleQuarantines.filter((path) => {
        try {
          statSync(path);
          return false;
        } catch {
          return true;
        }
      }).length,
      1
    );
  });
});
