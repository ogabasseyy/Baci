import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { EXPECTED_PENDING_SOURCES } from './expected-pending-sources.test-support';
import { EXPECTED_PIGGYVEST_MAIN_PENDING_SOURCES } from './expected-piggyvest-main-pending-sources.test-support';
import { EXPECTED_PRIMARY_PENDING_SOURCES } from './expected-primary-pending-sources.test-support';
import { supabaseHistoryReplayManifest } from './supabase-history-replay-manifest';
import { verifyCurrentMigrationRegistry } from './verify-current-migration-registry';

const root = path.resolve(__dirname, '../../../..');
const execFileAsync = promisify(execFile);

describe('bugfix: PR 3620 pending migration registry', () => {
  it('registers all 57 primary additions only as pending sources', async () => {
    const manifest = supabaseHistoryReplayManifest;
    expect(EXPECTED_PRIMARY_PENDING_SOURCES).toHaveLength(57);

    for (const expected of EXPECTED_PRIMARY_PENDING_SOURCES) {
      expect(
        manifest.pendingSources.filter(
          (source) => source.repositoryPath === expected.repositoryPath
        )
      ).toEqual([expected]);
      expect(
        EXPECTED_PENDING_SOURCES.find(
          (source) => source.repositoryPath === expected.repositoryPath
        )
      ).toEqual(expected);
      expect(
        manifest.postReplaySources.some(
          (source) => source.repositoryPath === expected.repositoryPath
        )
      ).toBe(false);
      expect(
        manifest.productionMappings.some(
          (source) => source.repositoryPath === expected.repositoryPath
        )
      ).toBe(false);
      const bytes = await readFile(path.join(root, expected.repositoryPath));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(
        expected.sha256
      );
    }
  });

  it('keeps primary additions disjoint from canonical main savings registrations', () => {
    const canonicalPaths = new Set(
      EXPECTED_PIGGYVEST_MAIN_PENDING_SOURCES.map(
        (source) => source.repositoryPath
      )
    );
    for (const source of EXPECTED_PRIMARY_PENDING_SOURCES) {
      expect(canonicalPaths.has(source.repositoryPath)).toBe(false);
      expect(source.repositoryPath).toMatch(/\/2026100[78]\d{6}_/);
    }
    const paths = supabaseHistoryReplayManifest.pendingSources.map(
      (source) => source.repositoryPath
    );
    expect(new Set(paths).size).toBe(paths.length);
    for (const filename of [
      '20260925130000_customer_savings_engagement_storage.sql',
      '20260926120000_piggyvest_staging_customer_mapping_read.sql',
      '20261001140000_piggyvest_interest_existing_authority.sql',
      '20261001230000_customer_savings_interest_policy.sql',
    ]) {
      expect(paths).not.toContain(`supabase/migrations/${filename}`);
    }
  });

  it('matches the complete current registry with the materialized pending repair', async () => {
    const manifest = supabaseHistoryReplayManifest;
    const { stdout } = await execFileAsync(
      'git',
      ['ls-tree', '--name-only', manifest.baseSha, 'supabase/migrations/'],
      { cwd: root }
    );
    const basePaths = stdout
      .trim()
      .split('\n')
      .filter((name) => name.endsWith('.sql'));
    await expect(
      verifyCurrentMigrationRegistry(root, [
        ...basePaths,
        manifest.repair.path,
        ...manifest.forwardRepairs.map((source) => source.path),
        ...manifest.postReplaySources.map((source) => source.repositoryPath),
        ...manifest.pendingSources.map((source) => source.repositoryPath),
      ])
    ).resolves.toBeUndefined();
  });
});
