import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPECTED_PAYSTACK_PENDING_SOURCES } from './expected-paystack-pending-sources.test-support';
import { PAYSTACK_PENDING_SOURCES } from './supabase-history-replay-paystack-pending-sources';

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');

function parseSources(value: string) {
  return value.split('\n').map((line) => {
    const [sha256, filename, ...remainder] = line.split(' ');
    if (!sha256 || !filename || remainder.length > 0) {
      throw new Error(`Invalid paystack replay source row: ${line}`);
    }
    return {
      repositoryPath: `supabase/migrations/${filename}`,
      sha256,
    };
  });
}

describe('PAYSTACK_PENDING_SOURCES', () => {
  it('contains the ordered paystack pending batch without malformed rows', () => {
    const sources = parseSources(PAYSTACK_PENDING_SOURCES);

    expect(sources).toEqual(EXPECTED_PAYSTACK_PENDING_SOURCES);
    expect(sources.at(-1)?.repositoryPath).toBe(
      'supabase/migrations/20260827060300_restrict_paystack_payable_refresh.sql'
    );
  });

  it('pins every registered migration to its current checked-in bytes', async () => {
    const sources = parseSources(PAYSTACK_PENDING_SOURCES);

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
