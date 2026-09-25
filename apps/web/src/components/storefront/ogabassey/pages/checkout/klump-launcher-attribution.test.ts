import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BnplOrder } from '@/lib/klump-utils';
import { captureBnplPaymentFailed } from './capture-bnpl-payment-failed';
import { captureBnplPaymentStarted } from './capture-bnpl-payment-started';
import {
  captureKlumpLauncherFailed,
  captureKlumpLauncherStarted,
} from './klump-launcher-attribution';

vi.mock('./capture-bnpl-payment-started', () => ({
  captureBnplPaymentStarted: vi.fn(),
}));

vi.mock('./capture-bnpl-payment-failed', () => ({
  captureBnplPaymentFailed: vi.fn(),
}));

function orderWith(overrides: Partial<BnplOrder> = {}): BnplOrder {
  return {
    id: 'order-1',
    order_number: 'ORD-1',
    total: 25000,
    currency: 'NGN',
    ...overrides,
  } as BnplOrder;
}

describe('klump launcher attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records a klump start with the verified amount', () => {
    captureKlumpLauncherStarted({
      order: orderWith(),
      reference: 'ref-1',
    });

    expect(captureBnplPaymentStarted).toHaveBeenCalledWith({
      orderId: 'order-1',
      orderNumber: 'ORD-1',
      paymentMethod: 'klump',
      reference: 'ref-1',
      value: 25000,
      currency: 'NGN',
    });
  });

  it('records a klump failure with the klump_error reason', () => {
    captureKlumpLauncherFailed({
      order: orderWith({ total: '9999.5', currency: ' USD ' }),
      reference: 'ref-2',
    });

    expect(captureBnplPaymentFailed).toHaveBeenCalledWith({
      orderId: 'order-1',
      orderNumber: 'ORD-1',
      paymentMethod: 'klump',
      reason: 'klump_error',
      reference: 'ref-2',
      value: 9999.5,
      currency: 'USD',
    });
  });

  it('omits unverifiable amounts instead of emitting NaN', () => {
    captureKlumpLauncherStarted({
      order: orderWith({ total: 'not-a-number', currency: '  ' }),
    });

    expect(captureBnplPaymentStarted).toHaveBeenCalledWith({
      orderId: 'order-1',
      orderNumber: 'ORD-1',
      paymentMethod: 'klump',
      reference: undefined,
    });
  });
});
