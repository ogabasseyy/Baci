import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPECTED_PENDING_SOURCES } from './expected-pending-sources.test-support';
import { supabaseHistoryReplayManifest } from './supabase-history-replay-manifest';
import { SAVINGS_RUNTIME_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-savings-runtime-pending-sources';

const root = path.resolve(__dirname, '../../../..');
const rows = SAVINGS_RUNTIME_PENDING_REPLAY_SOURCE_ROWS.trim().split('\n');

describe('savings runtime pending migration registration', () => {
  it('registers at least one runtime migration', () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it.each(rows)('pins the exact reviewed bytes of %s', async (row) => {
    const [sha256, filename] = row.split(' ');
    const repositoryPath = `supabase/migrations/${filename}`;
    const entry = supabaseHistoryReplayManifest.pendingSources.find(
      (source) => source.repositoryPath === repositoryPath
    );
    expect(entry).toBeDefined();
    expect(
      EXPECTED_PENDING_SOURCES.find(
        (source) => source.repositoryPath === repositoryPath
      )
    ).toEqual(entry);
    const bytes = await readFile(path.join(root, repositoryPath));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha256);
  });
});
