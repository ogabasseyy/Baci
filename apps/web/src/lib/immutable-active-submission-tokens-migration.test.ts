import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260903215000_immutable_active_submission_tokens.sql'
  ),
  'utf8'
);

describe('immutable active submission tokens migration', () => {
  it('keeps non-stale provider_submitting tokens immutable in reserve', () => {
    expect(sql).toContain("v_existing.status = 'provider_submitting'");
    expect(sql).toContain('STALE_PROVIDER_SUBMISSION');
    expect(sql).toContain(
      'recover_merchant_shipping_charge_for_persisted_shipment'
    );
    const reserveStart = sql.indexOf(
      'CREATE OR REPLACE FUNCTION public.reserve_merchant_shipping_charge'
    );
    const recoverStart = sql.indexOf(
      'CREATE OR REPLACE FUNCTION public.recover_merchant_shipping_charge_for_persisted_shipment'
    );
    const reserveSql = sql.slice(reserveStart, recoverStart);
    expect(reserveSql).toContain("v_existing.status = 'reserved'");
    expect(reserveSql).not.toMatch(
      /ELSIF v_existing\.status = 'provider_submitting' THEN[\s\S]*attempt_token_digest/
    );
  });

  it('rotates the token only after verifying a matching shipment', () => {
    const recoverStart = sql.indexOf(
      'CREATE OR REPLACE FUNCTION public.recover_merchant_shipping_charge_for_persisted_shipment'
    );
    const recoverSql = sql.slice(recoverStart);
    const shipmentCheck = recoverSql.indexOf('FROM public.shipments AS s');
    const tokenRotate = recoverSql.indexOf('attempt_token_digest = v_digest');
    const bookedUpdate = recoverSql.indexOf("status = 'booked'");
    expect(shipmentCheck).toBeGreaterThan(-1);
    expect(tokenRotate).toBeGreaterThan(shipmentCheck);
    expect(bookedUpdate).toBeGreaterThan(shipmentCheck);
    expect(recoverSql).toContain('shipment_binding_mismatch');
  });
});
