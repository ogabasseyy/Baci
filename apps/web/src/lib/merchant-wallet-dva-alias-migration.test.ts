import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  `${process.cwd()}/../../supabase/migrations/20260903120500_guard_merchant_wallet_paystack_dva_alias.sql`,
  'utf8'
);

describe('merchant wallet Paystack DVA alias guard', () => {
  it('serializes merchant-wallet assignments on the shared account lock', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.persist_merchant_wallet_payment_account('
    );
    expect(sql).toContain(
      "'paystack_order_account:' || trim(p_account_number)"
    );
    expect(sql).toContain('public.order_payment_accounts');
    expect(sql).toContain('public.customer_wallet_payment_accounts');
    expect(sql).toContain('public.checkout_sessions');
    expect(sql).toContain("MESSAGE = 'PAYSTACK_DVA_ALIAS_CONFLICT'");
  });

  it('teaches existing order, wallet, and agentic guards about merchant wallets', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.guard_order_paystack_dva_alias()'
    );
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.guard_wallet_paystack_dva_alias()'
    );
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.guard_agentic_paystack_dva_alias()'
    );
    expect(
      sql.match(/public\.merchant_wallet_payment_accounts/g)?.length
    ).toBeGreaterThanOrEqual(4);
  });

  it('installs a merchant-wallet trigger on the same account lock', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.guard_merchant_wallet_paystack_dva_alias()'
    );
    expect(sql).toMatch(
      /CREATE TRIGGER guard_merchant_wallet_paystack_dva_alias\s+BEFORE INSERT OR UPDATE OF provider, status, account_number/s
    );
    expect(sql).toContain('ON public.merchant_wallet_payment_accounts');
  });
});
