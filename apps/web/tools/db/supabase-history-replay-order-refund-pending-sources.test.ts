import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPECTED_PENDING_ORDER_REFUND_SOURCES } from './expected-pending-order-refund-sources.test-support';
import { ORDER_REFUND_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-order-refund-pending-sources';

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');

function parseSources(value: string) {
  return value.split('\n').map((line) => {
    const [sha256, filename, ...remainder] = line.split(' ');
    if (!sha256 || !filename || remainder.length > 0) {
      throw new Error(`Invalid order-refund replay source row: ${line}`);
    }
    return {
      repositoryPath: `supabase/migrations/${filename}`,
      sha256,
    };
  });
}

describe('ORDER_REFUND_PENDING_REPLAY_SOURCE_ROWS', () => {
  it('contains the ordered order-refund pending batch without malformed rows', () => {
    const sources = parseSources(ORDER_REFUND_PENDING_REPLAY_SOURCE_ROWS);

    expect(sources).toEqual(EXPECTED_PENDING_ORDER_REFUND_SOURCES);
    expect(sources.at(-1)?.repositoryPath).toBe(
      'supabase/migrations/20261016040000_verify_stamped_manual_paystack_refunds.sql'
    );
  });

  it('pins every registered migration to its current checked-in bytes', async () => {
    const sources = parseSources(ORDER_REFUND_PENDING_REPLAY_SOURCE_ROWS);

    await Promise.all(
      sources.map(async ({ repositoryPath, sha256 }) => {
        const bytes = await readFile(
          path.join(REPOSITORY_ROOT, repositoryPath)
        );

        expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha256);
      })
    );
  });
});
