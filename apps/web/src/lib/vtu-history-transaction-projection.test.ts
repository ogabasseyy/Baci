import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getPaymentStatusKey,
  type HistoryTransactionRow,
  isPaymentGateway,
  parseHistoryAmount,
  parseHistoryCashback,
  projectHistoryTransaction,
} from './vtu-history-transaction-projection';

function row(overrides: Partial<HistoryTransactionRow> = {}) {
  return {
    id: 'txn-1',
    amount: '500',
    customer_cashback: '25',
    metadata: {},
    status: 'successful',
    transaction_id: 'internal-1',
    type: 'airtime',
    ...overrides,
  };
}

describe('vtu-history-transaction-projection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('strips internals and coerces numerics', () => {
    const projected = projectHistoryTransaction({
      paymentStatusByReference: new Map(),
      transaction: row({ source: 'checkout', customer_id: 'customer-1' }),
      voucherPin: null,
    });

    expect(projected.transaction_id).toBeUndefined();
    expect(projected.metadata).toBeUndefined();
    // Refund inputs stay private to the projection (no UUID/source leak).
    expect(projected.source).toBeUndefined();
    expect(projected.customer_id).toBeUndefined();
    expect(projected.amount).toBe(500);
    expect(projected.customer_cashback).toBe(25);
    expect(projected.type).toBe('airtime');
  });

  it('falls back to zero with a log on invalid numerics', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const projected = projectHistoryTransaction({
      paymentStatusByReference: new Map(),
      transaction: row({ amount: 'nah', customer_cashback: 'nah' }),
      voucherPin: null,
    });

    expect(projected.amount).toBe(0);
    expect(projected.customer_cashback).toBe(0);
    expect(error).toHaveBeenCalledTimes(2);
  });

  it('keeps null cashback null without parsing', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const projected = projectHistoryTransaction({
      paymentStatusByReference: new Map(),
      transaction: row({ customer_cashback: null }),
      voucherPin: null,
    });

    expect(projected.customer_cashback).toBeNull();
    expect(error).not.toHaveBeenCalled();
  });

  it('joins the payment status by gateway and reference', () => {
    const paymentStatusByReference = new Map([
      [getPaymentStatusKey('paystack', 'PAY-1'), 'success'],
    ]);
    const projected = projectHistoryTransaction({
      paymentStatusByReference,
      transaction: row({
        metadata: { gateway: 'paystack', paymentReference: 'PAY-1' },
      }),
      voucherPin: 'PIN-1',
    });

    expect(projected.payment_gateway).toBe('paystack');
    expect(projected.payment_reference).toBe('PAY-1');
    expect(projected.payment_status).toBe('success');
    expect(projected.voucher_pin).toBe('PIN-1');
  });

  it('nulls the payment join when the gateway is unknown', () => {
    const projected = projectHistoryTransaction({
      paymentStatusByReference: new Map([['other:PAY-1', 'success']]),
      transaction: row({
        metadata: { gateway: 'other', paymentReference: 'PAY-1' },
      }),
      voucherPin: null,
    });

    expect(isPaymentGateway('other')).toBe(false);
    expect(projected.payment_gateway).toBeNull();
    expect(projected.payment_status).toBeNull();
  });

  it('surfaces receipt fields and the refund projection', () => {
    const projected = projectHistoryTransaction({
      paymentStatusByReference: new Map(),
      transaction: row({
        metadata: {
          address: '12 Allen Ave',
          dataPlanCode: 'MTN-1GB',
          refundIssued: true,
          refundAmount: 100,
          paymentSplit: { wallet: 400 },
          units: '9.2',
          walletDebited: true,
        },
        status: 'failed',
      }),
      voucherPin: null,
    });

    expect(projected.repeat_data_plan_code).toBe('MTN-1GB');
    expect(projected.units).toBe('9.2');
    expect(projected.address).toBe('12 Allen Ave');
    expect(projected.refund_pending).toBe(false);
    // Card leg 100 + reversed wallet leg 400.
    expect(projected.refunded_to_wallet).toBe(500);
  });

  it('parses amounts and cashback directly', () => {
    expect(parseHistoryAmount('500', 'txn-1')).toBe(500);
    expect(parseHistoryCashback(25, 'txn-1')).toBe(25);
  });
});
