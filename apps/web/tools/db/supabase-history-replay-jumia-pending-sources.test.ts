import { describe, expect, it } from 'vitest';
import { JUMIA_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-jumia-pending-sources';

const ROW_PATTERN = /^[0-9a-f]{64} 202\d{11}_[a-z0-9_]+\.sql$/;

describe('Jumia pending replay source rows', () => {
  it('contains only valid frozen migration rows', () => {
    const rows = JUMIA_PENDING_REPLAY_SOURCE_ROWS.trim().split('\n');

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => ROW_PATTERN.test(row))).toBe(true);
  });

  it('keeps Jumia migrations in chronological order without duplicates', () => {
    const rows = JUMIA_PENDING_REPLAY_SOURCE_ROWS.trim().split('\n');
    const versions = rows.map((row) => row.split(' ')[1].slice(0, 14));

    expect(new Set(rows).size).toBe(rows.length);
    expect(versions).toEqual([...versions].sort());
    expect(rows.at(-1)).toContain(
      '20260925120000_raise_jumia_credential_ciphertext_limit.sql'
    );
  });
});
