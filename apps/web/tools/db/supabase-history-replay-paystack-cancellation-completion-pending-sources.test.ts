import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAYSTACK_CANCELLATION_COMPLETION_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-paystack-cancellation-completion-pending-sources';

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');

describe('paystack cancellation completion pending replay sources', () => {
  it('pins each migration to its checked-in bytes', async () => {
    const rows =
      PAYSTACK_CANCELLATION_COMPLETION_PENDING_REPLAY_SOURCE_ROWS.trim().split(
        '\n'
      );
    expect(rows).toHaveLength(35);
    const filenames = rows.map((row) => row.split(' ')[1]);
    expect(new Set(filenames).size).toBe(filenames.length);

    await Promise.all(
      rows.map(async (row) => {
        const [sha256, filename, ...extra] = row.split(' ');
        if (!sha256 || !filename || extra.length !== 0) {
          throw new Error(
            'Invalid paystack cancellation completion pending replay source row'
          );
        }
        expect(sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(filename).toMatch(/^202\d{11}_[a-z0-9_]+\.sql$/);
        expect(extra).toEqual([]);

        const migration = await readFile(
          path.join(REPOSITORY_ROOT, 'supabase/migrations', filename)
        );
        expect(createHash('sha256').update(migration).digest('hex')).toBe(
          sha256
        );
      })
    );
  });
});
