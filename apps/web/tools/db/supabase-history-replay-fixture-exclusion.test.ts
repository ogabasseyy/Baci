import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPECTED_PENDING_SOURCES } from './expected-pending-sources.test-support';
import { supabaseHistoryReplayManifest } from './supabase-history-replay-manifest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
// The five October 4 legacy interest-capacity drafts are test fixtures
// only (supabase/migrations/tests/fixtures/...): they must never be
// registered as production migrations or appear in any replay/pending
// inventory. Placement inside the migrations tree relies on tooling
// ignoring subdirectories, so this guard fails loudly if any draft
// version leaks into the canonical registry or its inventories.
const FIXTURE_VERSIONS = [
  '20261004200000',
  '20261004200100',
  '20261004200200',
  '20261004200300',
  '20261004200400',
];

function leaks(version: string, repositoryPath: string): boolean {
  return repositoryPath.includes(version);
}

describe('legacy interest-capacity fixtures stay fixture-only', () => {
  it('excludes the five draft versions from the top-level migration registry', async () => {
    const names = await readdir(path.join(REPO_ROOT, 'supabase/migrations'));
    const leaked = names.filter((name) =>
      FIXTURE_VERSIONS.some((version) => name.startsWith(version))
    );
    expect(leaked).toEqual([]);
  });

  it('excludes the five draft versions from the replay manifest and pending-source inventories', () => {
    const manifest = supabaseHistoryReplayManifest;
    const inventoryPaths = [
      manifest.repair.path,
      ...manifest.forwardRepairs.map(({ path: repairPath }) => repairPath),
      ...manifest.pendingSources.map(({ repositoryPath }) => repositoryPath),
      ...manifest.postReplaySources.map(({ repositoryPath }) => repositoryPath),
      ...EXPECTED_PENDING_SOURCES.map(({ repositoryPath }) => repositoryPath),
    ];
    const leaked = inventoryPaths.filter((repositoryPath) =>
      FIXTURE_VERSIONS.some((version) => leaks(version, repositoryPath))
    );
    expect(leaked).toEqual([]);
  });
});
