import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260903210000_recover_wallet_funding_and_block_booked_rebinding.sql'
  ),
  'utf8'
);

describe('recover wallet funding and block booked rebinding migration', () => {
  it('blocks quote replacement while a booked wallet charge exists', () => {
    expect(sql).toContain(
      "c.status IN (\n        'reserved',\n        'provider_submitting',\n        'needs_reconciliation',\n        'booked'\n      )"
    );
    expect(sql).toContain("charge.status = 'booked'");
    expect(sql).toContain("RAISE EXCEPTION 'order_already_shipped_or_booked'");
  });
});
