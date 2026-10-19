import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260902100100_harden_gigl_wallet_migration_review.sql'
  ),
  'utf8'
);

describe('GIGL wallet migration review fixes', () => {
  it('restores authenticated owner reads after table revokes', () => {
    expect(sql).toContain(
      'GRANT SELECT ON TABLE public.merchant_wallet_funding_account_requests,'
    );
    expect(sql).toContain(
      'public.merchant_wallet_payment_accounts TO authenticated'
    );
    expect(sql).toContain(
      'GRANT INSERT ON TABLE public.merchant_wallet_funding_account_requests TO authenticated'
    );
    expect(sql).not.toMatch(
      /GRANT\s+(?:INSERT|UPDATE|DELETE|ALL).*merchant_wallet_payment_accounts.*TO authenticated/i
    );
  });

  it('indexes every new wallet and shipping-charge foreign key', () => {
    for (const index of [
      'merchant_wallet_funding_account_requests_merchant_id_idx',
      'merchant_wallet_payment_accounts_merchant_id_idx',
      'merchant_wallet_payment_accounts_request_id_idx',
      'merchant_shipping_charges_merchant_id_idx',
      'merchant_shipping_charges_order_id_idx',
      'merchant_shipping_charges_shipping_quote_id_idx',
      'merchant_shipping_charges_debit_transaction_id_idx',
      'merchant_shipping_charges_refund_transaction_id_idx',
      'merchant_shipping_charges_shipment_id_idx',
    ]) {
      expect(sql).toContain(index);
    }
  });

  it('qualifies the inserted charge status and binds receiver snapshots', () => {
    expect(sql).toContain(
      'RETURNING charge.id, charge.status INTO v_charge_id, v_charge_status'
    );
    expect(sql).toContain(
      "v_attestation.quote_request->'receiver' IS DISTINCT FROM p_receiver"
    );
  });

  it('restricts Admin quote persistence and binding to processing orders', () => {
    expect(sql).toContain(
      "lower(COALESCE(o.shipping_status, '')) = 'processing'"
    );
    expect(sql).toContain(
      "lower(COALESCE(v_order.shipping_status, '')) IS DISTINCT FROM 'processing'"
    );
  });
});
