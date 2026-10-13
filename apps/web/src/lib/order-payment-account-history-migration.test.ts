import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260828002000_restore_non_paystack_order_account_uniqueness.sql'
  ),
  'utf8'
);

describe('non-Paystack order payment-account uniqueness migration', () => {
  it('keeps one row per order and provider without collapsing Paystack history', () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS unique_order_non_paystack_account'
    );
    expect(migration).toContain(
      'ON public.order_payment_accounts (order_id, provider)'
    );
    expect(migration).toContain("WHERE provider <> 'paystack'");
    expect(migration).not.toContain('DROP CONSTRAINT');
  });
});
