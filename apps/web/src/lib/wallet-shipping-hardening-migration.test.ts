import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const hardening = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260901204000_harden_wallet_charge_and_account_updates.sql'
  ),
  'utf8'
);
const indexes = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260901205000_add_wallet_shipping_fk_indexes.sql'
  ),
  'utf8'
);

describe('wallet shipping hardening migrations', () => {
  it('uses an unambiguous reserve result row and preserves latest account assignment fields', () => {
    expect(hardening).toContain('RETURNING * INTO v_new_charge');
    expect(hardening).toContain('v_new_charge.status');
    expect(hardening).not.toContain(
      'RETURNING id,status INTO v_charge_id,v_charge_status'
    );
    expect(hardening).toContain('request_id=EXCLUDED.request_id');
    expect(hardening).toContain(
      'provider_account_id=EXCLUDED.provider_account_id'
    );
    expect(hardening).toContain(
      'provider_customer_code=EXCLUDED.provider_customer_code'
    );
    expect(hardening).toContain(
      'v_attestation public.shipping_quote_attestations%ROWTYPE'
    );
    expect(hardening).toContain(
      "v_order.shipping_funding_source IS DISTINCT FROM 'merchant_wallet'"
    );
    expect(hardening).toContain(
      'v_attestation.quote_request IS DISTINCT FROM v_quote.quote_request'
    );
    expect(hardening).toContain(
      '(v_existing.id IS NULL AND v_quote.expires_at <= now())'
    );
    expect(
      hardening.indexOf(
        'v_attestation.quote_request IS DISTINCT FROM v_quote.quote_request'
      )
    ).toBeLessThan(hardening.indexOf('IF v_existing.id IS NOT NULL THEN'));
  });
  it('fails closed for every non-refunded charge status', () => {
    expect(hardening).toContain("c.status IS DISTINCT FROM 'refunded'");
    expect(hardening).toContain(
      'active_shipping_charge_quote_replacement_blocked'
    );
  });
  it('adds indexes for all new foreign keys', () => {
    for (const name of [
      'merchant_id',
      'shipping_quote_id',
      'debit_transaction_id',
      'refund_transaction_id',
      'shipment_id',
    ])
      expect(indexes).toContain(`merchant_shipping_charges_${name}_idx`);
    expect(indexes).toContain(
      'merchant_wallet_payment_accounts_request_id_idx'
    );
    expect(indexes).toContain('shipping_quote_attestations_order_id_idx');
    expect(indexes).toContain('shipping_quote_attestations_merchant_id_idx');
  });
});
