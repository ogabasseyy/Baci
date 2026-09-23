import { describe, expect, it } from 'vitest';
import type { StorefrontOrderData } from './fetch-storefront-order';
import { buildPayerHandoff } from './order-success-payer-handoff';

function baseOrder(): StorefrontOrderData {
  return {
    id: 'order-1',
    order_number: 'BAC-001',
    total: 5000,
    amount_paid: 2000,
    payment_status: 'pending',
    shipping_status: 'pending',
    currency: 'NGN',
    virtual_account: {
      bank_name: 'Paystack',
      account_name: 'BACI Test',
      account_number: '0123456789',
    },
  } as never;
}

describe('buildPayerHandoff', () => {
  it('builds copyable instructions for an unpaid payforme order', () => {
    const handoff = buildPayerHandoff({
      merchantCountry: 'NG',
      order: baseOrder(),
      payerNameParam: 'Zain',
      type: 'payforme',
    });

    expect(handoff.isPayForMeUnpaid).toBe(true);
    expect(handoff.payerOutstandingBalance).toBe(3000);
    expect(handoff.payerName).toBe('Zain');
    expect(handoff.payerDetailsText).toContain('BAC-001');
    expect(handoff.payerTransferAccount?.account_number).toBe('0123456789');
  });

  it('suppresses the handoff for terminal or paid orders', () => {
    expect(
      buildPayerHandoff({
        order: { ...baseOrder(), payment_status: 'paid', amount_paid: 5000 },
        payerNameParam: null,
        type: 'payforme',
      }).isPayForMeUnpaid
    ).toBe(false);
    expect(
      buildPayerHandoff({
        order: { ...baseOrder(), payment_status: 'cancelled' },
        payerNameParam: null,
        type: 'payforme',
      }).isPayForMeUnpaid
    ).toBe(false);
    expect(
      buildPayerHandoff({
        order: baseOrder(),
        payerNameParam: null,
        type: 'standard',
      }).isPayForMeUnpaid
    ).toBe(false);
  });

  it('keeps foreign-currency amounts off the naira DVA', () => {
    const handoff = buildPayerHandoff({
      order: { ...baseOrder(), currency: 'USD' },
      payerNameParam: null,
      type: 'payforme',
    });

    expect(handoff.isPayForMeUnpaid).toBe(true);
    expect(handoff.payerTransferAccount).toBeNull();
  });
});
