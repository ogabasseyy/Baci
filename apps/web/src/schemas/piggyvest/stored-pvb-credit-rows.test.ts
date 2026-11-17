import { describe, expect, it } from 'vitest';
import { storedPvbCreditRowSchemas as schemas } from './stored-pvb-credit-rows';

const inflow = {
  pvb_reference: 'PVB01SYNTHETIC',
  provider_transaction_id: 'txn',
  customer_id: 'customer',
  wallet_id: 'wallet',
  amount_kobo: 1000,
  fee_kobo: 0,
  reference: 'ref',
  session_id: null,
  event_data_id: 'data',
  credited_at: '2026-11-11 10:00:00+00',
};
const interest = {
  pvb_reference: 'PVB01SYNTHETIC',
  provider_payout_id: 'payout',
  customer_id: 'customer',
  wallet_id: 'wallet',
  amount_kobo: 90,
  gross_kobo: 100,
  withholding_tax_kobo: 10,
  net_kobo: 90,
  reference: 'ref',
  batch_id: 'batch',
  paid_at: '2026-11-11 10:00:00+00',
};

describe('storedPvbCreditRowSchemas', () => {
  it('accepts current and legacy (null pvb_reference) rows', () => {
    expect(schemas.inflow.safeParse(inflow).success).toBe(true);
    expect(
      schemas.inflow.safeParse({ ...inflow, pvb_reference: null }).success
    ).toBe(true);
    expect(schemas.interest.safeParse(interest).success).toBe(true);
    expect(
      schemas.interest.safeParse({ ...interest, pvb_reference: null }).success
    ).toBe(true);
  });

  it('rejects a row missing the pvb_reference column or the audit key', () => {
    const { pvb_reference: _ref, ...noReference } = inflow;
    expect(schemas.inflow.safeParse(noReference).success).toBe(false);
    expect(
      schemas.interest.safeParse({ ...interest, provider_payout_id: '' })
        .success
    ).toBe(false);
  });

  it('rejects negative or fractional kobo', () => {
    expect(
      schemas.inflow.safeParse({ ...inflow, amount_kobo: -1 }).success
    ).toBe(false);
    expect(
      schemas.interest.safeParse({ ...interest, net_kobo: 1.5 }).success
    ).toBe(false);
  });
});
