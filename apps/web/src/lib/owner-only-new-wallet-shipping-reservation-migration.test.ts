import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260905102000_owner_only_new_wallet_shipping_reservation.sql'
  ),
  'utf8'
);

describe('owner-only new wallet shipping reservation migration', () => {
  it('keeps staff fulfill/edit for existing-charge recovery', () => {
    expect(sql).toContain("'orders', 'fulfill'");
    expect(sql).toContain("'orders', 'edit'");
    expect(sql).toContain('check_staff_permission');
  });

  it('requires the merchant owner before creating a new wallet debit', () => {
    const ownerGate = sql.indexOf(
      "RAISE EXCEPTION 'wallet_reservation_owner_required'"
    );
    const newDebitComment = sql.indexOf('New wallet debits move owner funds');
    const walletInsert = sql.indexOf('INSERT INTO public.wallet_transactions(');
    const existingRecovery = sql.indexOf('IF v_existing.id IS NOT NULL THEN');
    expect(ownerGate).toBeGreaterThan(existingRecovery);
    expect(ownerGate).toBeGreaterThan(newDebitComment);
    expect(walletInsert).toBeGreaterThan(ownerGate);
    expect(sql).toContain('merchant.user_id = (SELECT auth.uid())');
  });
});
