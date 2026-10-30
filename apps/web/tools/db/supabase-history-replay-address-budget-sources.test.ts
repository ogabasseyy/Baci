// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ADDRESS_BUDGET_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-address-budget-sources';

describe('address ledger migration source bindings', () => {
  it('binds the staged guard and ledger to their complete migration bytes', () => {
    const rows = ADDRESS_BUDGET_PENDING_REPLAY_SOURCE_ROWS.split('\n');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const [expectedHash, name] = row.split(' ');
      const bytes = readFileSync(
        new URL(`../../../../supabase/migrations/${name}`, import.meta.url)
      );
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(
        expectedHash
      );
    }
    expect(rows[0]).toContain(
      '20261030075538_address_provider_budget_gigl_guard.sql'
    );
    expect(rows[1]).toContain(
      '20261030075540_address_provider_budget_gigl_ledger.sql'
    );
  });
});
