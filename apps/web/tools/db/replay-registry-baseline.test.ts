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
    count: 1645,
    sha256: '6954f0d3e2c1a3775d574641e8c16cfb3b6d96fa59cd4e0e6a36f98854e50e24',
  },
  pending: {
    count: 1645,
    sha256: '6717ee2d191d2a63189638a27e5e44f98baac305b262c57bbc0a3fbcb8581e11',
  },
  sqlChecks: {
    count: 187,
    sha256: 'e3043151c70b1c14f71d16c44f288265b56551b00cad0dff37e792f82eecf68b',
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
