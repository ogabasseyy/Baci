import { describe, expect, it } from 'vitest';
import {
  type AttributionRow,
  hasUnresolvedRefundEvidence,
} from './cancel-refund-attribution';

const pay = (over: Partial<AttributionRow> = {}): AttributionRow => ({
  amount: 100,
  currency: 'NGN',
  gateway: 'paystack',
  id: 'pay-1',
  status: 'completed',
  transaction_type: 'payment',
  ...over,
});
const refund = (over: Partial<AttributionRow> = {}): AttributionRow => ({
  amount: 100,
  currency: 'NGN',
  gateway: 'paystack',
  id: 'ref-1',
  payment_transaction_id: 'pay-1',
  provider_refund_status: 'processed',
  status: 'completed',
  transaction_type: 'refund',
  ...over,
});
const unlinked = (over: Partial<AttributionRow> = {}) =>
  refund({ payment_transaction_id: null, ...over });
const check = (rows: AttributionRow[], orderCurrency = 'NGN') =>
  hasUnresolvedRefundEvidence(rows, orderCurrency);

describe('hasUnresolvedRefundEvidence', () => {
  describe('resolved shapes', () => {
    it('has nothing to attribute without refund rows', () => {
      expect(check([pay()])).toBe(false);
    });
    it('accepts a full linked processed refund', () => {
      expect(check([pay(), refund()])).toBe(false);
    });
    it('accepts a linked refund still in flight', () => {
      expect(check([pay(), refund({ status: 'refund_pending' })])).toBe(false);
    });
    it('accepts an unverified linked Paystack refund (the worker waits)', () => {
      expect(check([pay(), refund({ provider_refund_status: null })])).toBe(
        false
      );
    });
    it('accepts a full unlinked refund on the sole completed leg', () => {
      expect(check([pay(), unlinked()])).toBe(false);
    });
    it('accepts an unlinked refund beside a refunded sibling leg', () => {
      expect(
        check([pay(), pay({ id: 'pay-2', status: 'refunded' }), unlinked()])
      ).toBe(false);
    });
    it('defaults a blank order currency to NGN', () => {
      expect(check([pay(), refund()], '')).toBe(false);
    });
    it('accepts a linked manual refund in the leg currency', () => {
      expect(
        check([
          pay(),
          refund({ gateway: 'manual', provider_refund_status: null }),
        ])
      ).toBe(false);
    });
  });

  describe('invalid links', () => {
    it.each([
      'completed',
      'refund_pending',
      'processing',
      'failed',
    ])('flags a %s refund linked to a payment this order lacks', (status) => {
      expect(
        check([pay(), refund({ payment_transaction_id: 'gone', status })])
      ).toBe(true);
    });
  });

  describe('unlinked refunds', () => {
    it('flags one that several completed legs could own', () => {
      expect(check([pay(), pay({ id: 'pay-2' }), unlinked()])).toBe(true);
    });
    it.each([
      'pending',
      'processing',
      'refund_pending',
      'failed',
    ])('flags a non-terminal (%s) one even with a single leg', (status) => {
      expect(check([pay(), unlinked({ status })])).toBe(true);
    });
    it('flags a manual one', () => {
      expect(check([pay(), unlinked({ gateway: 'manual' })])).toBe(true);
    });
    it('flags one in another gateway than its sole leg', () => {
      expect(check([pay(), unlinked({ gateway: 'korapay' })])).toBe(true);
    });
    it('flags one in another currency than its sole leg', () => {
      expect(check([pay(), unlinked({ currency: 'USD' })])).toBe(true);
    });
    it('flags one with an invalid amount', () => {
      expect(check([pay(), unlinked({ amount: 0 })])).toBe(true);
    });
    it('flags one that does not fully cover the sole leg', () => {
      expect(check([pay(), unlinked({ amount: 20 })])).toBe(true);
    });
    it('is not owned by a refund_pending sibling when no completed leg is sole', () => {
      expect(
        check([
          pay({ status: 'refund_pending' }),
          pay({ id: 'pay-2', status: 'refund_pending' }),
          unlinked(),
        ])
      ).toBe(true);
    });
  });

  describe('linked refunds', () => {
    it('flags a different gateway than the leg', () => {
      expect(check([pay(), refund({ gateway: 'korapay' })])).toBe(true);
    });
    it('flags a different currency than the leg', () => {
      expect(check([pay(), refund({ currency: 'USD' })])).toBe(true);
    });
    it('flags a refund outside the order currency', () => {
      expect(
        check([pay({ currency: 'USD' }), refund({ currency: 'USD' })])
      ).toBe(true);
    });
    it('flags a zero-amount refund', () => {
      expect(check([pay(), refund({ amount: 0 })])).toBe(true);
    });
    it('flags non-manual coverage short of the full leg', () => {
      expect(check([pay(), refund({ amount: 20 })])).toBe(true);
    });
    it('flags a manual refund in another currency', () => {
      expect(
        check([pay(), refund({ currency: 'USD', gateway: 'manual' })])
      ).toBe(true);
    });
    it('flags an unverified manual Paystack declaration', () => {
      expect(
        check([
          pay(),
          refund({
            gateway: 'manual',
            provider_refund_status: null,
            refund_method: 'paystack',
          }),
        ])
      ).toBe(true);
    });
  });
});
