import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FOLLOW_UP_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-follow-up-pending-sources';

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');

describe('follow-up notification pending replay sources', () => {
  it('pins each preference migration to its checked-in bytes', async () => {
    const rows = FOLLOW_UP_PENDING_REPLAY_SOURCE_ROWS.split('\n');
    expect(rows).toHaveLength(3);

    for (const row of rows) {
      const [sha256, filename, ...extra] = row.split(' ');
      if (!sha256 || !filename || extra.length !== 0) {
        throw new Error('Invalid follow-up pending replay source row');
      }

      const migration = await readFile(
        path.join(REPOSITORY_ROOT, 'supabase/migrations', filename)
      );
      expect(createHash('sha256').update(migration).digest('hex')).toBe(sha256);
    }
  });
});
