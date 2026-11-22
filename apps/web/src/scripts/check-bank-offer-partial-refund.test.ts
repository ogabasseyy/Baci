import { describe, expect, it, vi } from 'vitest';
import { checkBankOfferPartialRefund } from './check-bank-offer-partial-refund';

const itemId = 'a0000000-0000-4000-8000-000000000001';
const unit = (unitNumber: number) => ({ itemId, unitNumber });
const snapshot = {
  capture: {
    reference: 'BCO-payment',
    id: '9007199254740993',
    domain: 'live',
    amountKobo: 1_000,
  },
  merchandiseNetKobo: 900,
  allocations: [{ itemId, unitNetAmountsKobo: [600, 300, 0] }],
};
const priorRefund = {
  id: '12',
  amount: 300,
  currency: 'NGN',
  status: 'pending',
};
const withPriorRefund = [{ refundId: '12', units: [unit(2)] }];

describe('bank-offer partial refund checker', () => {
  it('reconciles the saved quote, reserves pending refunds, and counts a zero-value returned unit', async () => {
    const listRefunds = vi
      .fn()
      .mockResolvedValue([
        priorRefund,
        { ...priorRefund, id: '13', status: 'failed' },
      ]);
    await expect(
      checkBankOfferPartialRefund(
        snapshot,
        {
          units: [unit(1), unit(3)],
          previousRefunds: withPriorRefund,
        },
        listRefunds
      )
    ).resolves.toEqual({
      suggestedRefundKobo: 600,
      remainingPaystackKobo: 700,
      returnedUnitCount: 2,
    });
    expect(listRefunds).toHaveBeenCalledWith(snapshot.capture);
  });

  it('rejects duplicate units in the same return before contacting Paystack', async () => {
    const listRefunds = vi.fn();
    await expect(
      checkBankOfferPartialRefund(
        snapshot,
        {
          units: [unit(1), unit(1)],
          previousRefunds: [],
        },
        listRefunds
      )
    ).rejects.toThrow('Duplicate unit');
    expect(listRefunds).not.toHaveBeenCalled();
  });

  it('rejects units assigned to a prior refund', async () => {
    await expect(
      checkBankOfferPartialRefund(
        snapshot,
        {
          units: [unit(2)],
          previousRefunds: withPriorRefund,
        },
        vi.fn()
      )
    ).rejects.toThrow('Duplicate unit');
  });

  it('rejects the proposed amount above the remaining Paystack balance', async () => {
    await expect(
      checkBankOfferPartialRefund(
        snapshot,
        {
          units: [unit(1)],
          previousRefunds: [],
        },
        vi.fn().mockResolvedValue([{ ...priorRefund, amount: 500 }])
      )
    ).rejects.toThrow('exceeds remaining Paystack balance');
  });

  it('rejects missing mappings and incorrect amounts on prior refunds', async () => {
    for (const previousRefunds of [
      [],
      [{ refundId: '12', units: [unit(3)] }],
    ]) {
      await expect(
        checkBankOfferPartialRefund(
          snapshot,
          {
            units: [unit(1)],
            previousRefunds,
          },
          vi.fn().mockResolvedValue([priorRefund])
        )
      ).rejects.toThrow('Reconcile prior Paystack refunds');
    }
  });

  it('rejects unknown units and out-of-balance allocations', async () => {
    await expect(
      checkBankOfferPartialRefund(
        snapshot,
        {
          units: [unit(4)],
          previousRefunds: [],
        },
        vi.fn()
      )
    ).rejects.toThrow('Unit is absent');
    await expect(
      checkBankOfferPartialRefund(
        { ...snapshot, merchandiseNetKobo: 901 },
        {
          units: [unit(1)],
          previousRefunds: [],
        },
        vi.fn()
      )
    ).rejects.toThrow('Saved allocations do not reconcile');
  });

  it('rejects repeated provider rows to avoid trusting ambiguous pagination', async () => {
    await expect(
      checkBankOfferPartialRefund(
        snapshot,
        {
          units: [unit(3)],
          previousRefunds: [],
        },
        vi.fn().mockResolvedValue([priorRefund, priorRefund])
      )
    ).rejects.toThrow('Unverified Paystack refund history');
  });
});
