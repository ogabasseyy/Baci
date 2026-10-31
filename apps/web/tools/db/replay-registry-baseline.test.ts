import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildExpectedPendingSources } from './build-expected-pending-sources.test-support';
import { buildPendingReplaySourceRows } from './build-pending-replay-source-rows';
import { EXPECTED_LEGACY_PENDING_SOURCES } from './expected-legacy-pending-sources.test-support';
import { EXPECTED_PENDING_SOURCES } from './expected-pending-sources.test-support';
import { replayRegistry } from './replay-registry';
import { replaySqlCheckRegistry } from './replay-sql-check-registry';
import { REPLAY_SOURCE_DATA } from './supabase-history-replay-sources';

// The registry replaced three hand-maintained shared lists. These pins are
// the hand-listed outputs captured before the switch: discovery over the
// frozen legacy modules plus the baseline folder must reproduce them byte for
// byte (same count, rows, and order). They cover only the baseline, so adding
// a new registry folder never touches this file.
const FROZEN = {
  expected: {
    count: 1646,
    sha256: '0e213372b96e44a415b00e7d05284c69293231f0aec848b7743ae7c1906dc35e',
  },
  pending: {
    count: 1646,
    sha256: '45c97d7aa760ce30195cdf48bbfcfd61d7031475264c09c1430fcb26008e0d78',
  },
  sqlChecks: {
    count: 188,
    sha256: 'dbd78e0f366d3592857190e5b58651712cd06357381e48a69198c1bf90d461fd',
  },
};
const BASELINE = '00000000000000_baseline';
const FROZEN_HINT =
  'The pre-registry baseline changed. Leave the frozen legacy modules and the baseline folder alone and register new work in a new replay-registry/<YYYYMMDDHHMMSS>_<slug>/ folder.';
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../../../..');
const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

const baselineOnly = mkdtempSync(path.join(tmpdir(), 'replay-registry-'));
cpSync(
  path.join(replayRegistry.directory, BASELINE),
  path.join(baselineOnly, BASELINE),
  { recursive: true }
);
afterAll(() => rmSync(baselineOnly, { force: true, recursive: true }));

describe('replay registry baseline', () => {
  it('reproduces the hand-listed pending replay rows', () => {
    const rows = buildPendingReplaySourceRows(baselineOnly);

    expect(rows.split('\n'), FROZEN_HINT).toHaveLength(FROZEN.pending.count);
    expect(sha256(rows), FROZEN_HINT).toBe(FROZEN.pending.sha256);
  });

  it('reproduces the hand-listed expected pending sources', () => {
    const sources = buildExpectedPendingSources(baselineOnly);

    expect(sources, FROZEN_HINT).toHaveLength(FROZEN.expected.count);
    expect(sha256(JSON.stringify(sources)), FROZEN_HINT).toBe(
      FROZEN.expected.sha256
    );
  });

  it('reproduces the hand-listed CI SQL suites in their original order', () => {
    const suites = replayRegistry
      .readList('sql-checks.txt', baselineOnly)
      .map(({ value }) => value);

    expect(suites, FROZEN_HINT).toHaveLength(FROZEN.sqlChecks.count);
    expect(sha256(`${suites.join('\n')}\n`), FROZEN_HINT).toBe(
      FROZEN.sqlChecks.sha256
    );
    expect(suites[0]).toBe(
      'supabase/tests/public_definer_function_exposure.sql'
    );
  });

  it('runs the baseline suites first, then later folders in folder order', () => {
    const suites = replaySqlCheckRegistry.readSuites(
      REPOSITORY_ROOT,
      'apps/web/tools/db/replay-registry'
    );
    const baseline = replayRegistry
      .readList('sql-checks.txt', baselineOnly)
      .map(({ value }) => value);

    expect(suites.slice(0, baseline.length)).toEqual(baseline);
  });

  it('feeds every discovered registry row into the manifest inputs', () => {
    expect(REPLAY_SOURCE_DATA.PENDING_SOURCES).toBe(
      buildPendingReplaySourceRows()
    );
    expect(EXPECTED_PENDING_SOURCES).toEqual(buildExpectedPendingSources());
  });

  it('never registers one expected migration with two different hashes', () => {
    const registered = replayRegistry
      .readSourceRows('expected-pending-sources.txt')
      .map((row) => ({
        repositoryPath: `supabase/migrations/${row.slice(65)}`,
        sha256: row.slice(0, 64),
      }));
    const hashes = new Map<string, Set<string>>();
    for (const { repositoryPath, sha256: hash } of [
      ...EXPECTED_LEGACY_PENDING_SOURCES,
      ...registered,
    ]) {
      hashes.set(
        repositoryPath,
        (hashes.get(repositoryPath) ?? new Set()).add(hash)
      );
    }
    const conflicting = [...hashes].filter(([, set]) => set.size > 1);

    expect(conflicting).toEqual([]);
  });
});
