import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { CONNECTOR_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-connector-pending-sources';

it('binds connector migrations to their recorded bytes', () => {
  const rows = CONNECTOR_PENDING_REPLAY_SOURCE_ROWS.split('\n');
  expect(rows).toHaveLength(8);
  for (const row of rows) {
    const [hash, name] = row.split(' ');
    const bytes = readFileSync(
      resolve(import.meta.dirname, '../../../../supabase/migrations', name)
    );
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(hash);
  }
});
