import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildExpectedPendingSources } from './build-expected-pending-sources.test-support';
import { buildPendingReplaySourceRows } from './build-pending-replay-source-rows';
import { replayRegistry } from './replay-registry';

// A new migration registers itself by adding one folder; neither aggregator
// module is edited. These tests copy the checked-in registry, add a folder,
// and rebuild both manifest inputs from the copy.
const NEW_FOLDER = '20991231235900_registry_probe';
const NEW_ROW = `${'d'.repeat(64)} 20991231235900_registry_probe.sql`;
const EARLY_ROW = `${'e'.repeat(64)} 20260101000000_registry_probe_early.sql`;
const copies: string[] = [];

function registryWith(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'replay-registry-copy-'));
  copies.push(root);
  cpSync(replayRegistry.directory, root, { recursive: true });
  for (const [relativePath, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
    writeFileSync(path.join(root, relativePath), body);
  }
  return root;
}

afterEach(() => {
  for (const root of copies.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('registry-driven pending replay inputs', () => {
  it('adds a new folder to the manifest rows in filename order', () => {
    const current = buildPendingReplaySourceRows().split('\n');
    const rows = buildPendingReplaySourceRows(
      registryWith({
        [`${NEW_FOLDER}/pending-sources.txt`]: `${NEW_ROW}\n${EARLY_ROW}\n`,
      })
    ).split('\n');

    expect(rows).toHaveLength(current.length + 2);
    expect(rows.at(-1)).toBe(NEW_ROW);
    expect(rows).toContain(EARLY_ROW);
    expect(rows.filter((row) => row !== NEW_ROW && row !== EARLY_ROW)).toEqual(
      current
    );
    const filenames = rows.map((row) => row.split(' ')[1] ?? '');
    expect(filenames).toEqual([...filenames].sort());
  });

  it('adds a new folder to the independent expected inventory', () => {
    const current = buildExpectedPendingSources();
    const sources = buildExpectedPendingSources(
      registryWith({
        [`${NEW_FOLDER}/expected-pending-sources.txt`]: `${NEW_ROW}\n`,
      })
    );

    expect(sources).toHaveLength(current.length + 1);
    expect(sources).toContainEqual({
      repositoryPath: 'supabase/migrations/20991231235900_registry_probe.sql',
      sha256: 'd'.repeat(64),
    });
  });

  it('keeps the two inventories independent', () => {
    const directory = registryWith({
      [`${NEW_FOLDER}/pending-sources.txt`]: `${NEW_ROW}\n`,
    });

    expect(buildPendingReplaySourceRows(directory)).toContain(NEW_ROW);
    expect(buildExpectedPendingSources(directory)).toEqual(
      buildExpectedPendingSources()
    );
  });

  it('fails the manifest build when a new folder is malformed', () => {
    const directory = registryWith({
      [`${NEW_FOLDER}/pending-sources.txt`]: `${NEW_ROW.toUpperCase()}\n`,
    });

    expect(() => buildPendingReplaySourceRows(directory)).toThrow(
      `${NEW_FOLDER}/pending-sources.txt:1 must be`
    );
  });

  it('fails the manifest build when a folder is misnamed', () => {
    const directory = registryWith({
      'registry_probe/pending-sources.txt': `${NEW_ROW}\n`,
    });

    expect(() => buildPendingReplaySourceRows(directory)).toThrow(
      'unexpected entry "registry_probe"'
    );
  });
});
