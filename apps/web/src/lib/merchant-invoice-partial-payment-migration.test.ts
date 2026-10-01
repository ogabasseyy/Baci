import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260805090000_complete_merchant_invoice_partial_payments.sql'
  ),
  'utf8'
);

describe('merchant invoice partial payment migration', () => {
  it('keeps allocation service-only and serialized with every order payment writer', () => {
    expect(migration).toContain(
      'forbidden: complete_merchant_invoice_partial_payment requires service_role'
    );
    expect(migration).toContain("'baci_order_payment:' || p_order_id::text");
    expect(migration).toMatch(/FROM public\.transactions[\s\S]*FOR UPDATE;/);
    expect(migration).toMatch(/FROM public\.orders[\s\S]*FOR UPDATE;/);
    expect(migration).toContain('recorded_by_user_id');
  });

  it('reconciles completed payment and wallet ledgers before applying the transfer', () => {
    expect(migration).toContain("t.transaction_type = 'payment'");
    expect(migration).toContain("t.status = 'completed'");
    expect(migration).toContain('t.id <> p_transaction_id');
    expect(migration).toContain('wallet_amount_used');
    expect(migration).toContain('greatest(v_order_amount_paid, v_ledger_paid)');
  });

  it('records only a strict underpayment and hands an exact balance to full completion', () => {
    expect(migration).toContain("'amount_now_completes_order'");
    expect(migration).toContain("'AMOUNT_EXCEEDS_REMAINING_BALANCE'");
    expect(migration).toContain(
      'v_balance_due := greatest(0, v_order_total - v_new_paid)'
    );
    expect(migration).toMatch(
      /UPDATE public\.order_payment_accounts AS account\s+SET payable_amount = v_balance_due\s+WHERE account\.order_id = p_order_id\s+AND account\.provider = 'paystack';/
    );
    expect(migration).toContain("payment_status = 'partially_paid'");
    expect(migration).not.toMatch(
      /payment_status = 'partially_paid'[\s\S]{0,300}shipping_status = 'processing'/
    );
  });

  it('atomically retires the completed partial from the full-payment wedge sweep', () => {
    expect(migration).toContain("status = 'completed'");
    expect(migration).toContain(
      "'wedge_sweep_resolution', 'merchant_invoice_partial_recorded'"
    );
    expect(migration).toContain("'merchant_invoice_partial_applied', true");
  });

  it('credits the merchant inside the same atomic function with validated fees', () => {
    expect(migration).toContain('p_verified_gateway_fee numeric');
    expect(migration).toContain('p_payment_platform_fee numeric');
    expect(migration).toContain(
      'p_verified_gateway_fee + p_payment_platform_fee > v_txn_amount'
    );
    expect(migration).toContain('PERFORM public.record_merchant_settlement(');
    expect(migration).toContain('p_gross_amount => v_txn_amount');
    expect(migration).toContain('p_gateway_fee => p_verified_gateway_fee');
    expect(migration).toContain('p_platform_fee => p_payment_platform_fee');
  });

  it('adds a transaction-scoped review type and exposes the RPC only to service_role', () => {
    expect(migration).toContain("'merchant_invoice_partial_payment_conflict'");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.complete_merchant_invoice_partial_payment\([\s\S]*FROM PUBLIC, anon, authenticated;/
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.complete_merchant_invoice_partial_payment\([\s\S]*TO service_role;/
    );
  });
});
