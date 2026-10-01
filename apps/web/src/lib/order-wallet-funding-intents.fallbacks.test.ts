import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerWalletPaymentAccountError } from '@/lib/customer-wallet-payment-accounts';
import { createOrderWalletFundingIntent } from '@/lib/order-wallet-funding-intents';
import {
  createRepository,
  customer,
  merchant,
} from '@/lib/order-wallet-funding-intents.test-utils';

const mockLoggerError = vi.hoisted(() => vi.fn());

vi.mock('@/lib/logger', () => ({
  logger: {
    error: mockLoggerError,
  },
}));

describe('createOrderWalletFundingIntent provisioning fallbacks', () => {
  beforeEach(() => {
    mockLoggerError.mockClear();
  });

  it('returns a typed missing-phone fallback when checkout consent cannot provision a DVA', async () => {
    const repository = createRepository({
      ensureWalletPaymentAccount: vi.fn(() => {
        throw new CustomerWalletPaymentAccountError(
          'CUSTOMER_PHONE_REQUIRED',
          'Customer phone number is required'
        );
      }),
      resolveWalletPaymentAccount: vi.fn(async () => null),
    });

    const result = await createOrderWalletFundingIntent({
      consent: true,
      customer: { ...customer, phone: null },
      merchant,
      orderId: 'order-1',
      repository,
      now: new Date('2026-05-26T12:00:00.000Z'),
    });

    expect(result).toEqual({
      code: 'CUSTOMER_PHONE_REQUIRED',
      kind: 'fallback',
    });
  });

  it('returns a typed missing-name fallback when checkout consent cannot provision a DVA', async () => {
    const repository = createRepository({
      ensureWalletPaymentAccount: vi.fn(() => {
        throw new CustomerWalletPaymentAccountError(
          'CUSTOMER_NAME_REQUIRED',
          'Customer first and last names are required'
        );
      }),
      resolveWalletPaymentAccount: vi.fn(async () => null),
    });

    const result = await createOrderWalletFundingIntent({
      consent: true,
      customer: { ...customer, first_name: null, last_name: null },
      merchant,
      orderId: 'order-1',
      repository,
      now: new Date('2026-05-26T12:00:00.000Z'),
    });

    expect(result).toEqual({
      code: 'CUSTOMER_NAME_REQUIRED',
      kind: 'fallback',
    });
  });

  it('returns a setup fallback when DVA provisioning throws an unexpected error', async () => {
    const repository = createRepository({
      ensureWalletPaymentAccount: vi.fn(() => {
        throw new Error('Paystack unavailable');
      }),
      resolveWalletPaymentAccount: vi.fn(async () => null),
    });

    const result = await createOrderWalletFundingIntent({
      consent: true,
      customer,
      merchant,
      orderId: 'order-1',
      repository,
      now: new Date('2026-05-26T12:00:00.000Z'),
    });

    expect(result).toEqual({
      code: 'WALLET_DVA_SETUP_FAILED',
      kind: 'fallback',
    });
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to resolve wallet account for order funding intent',
        orderId: 'order-1',
      })
    );
    expect(repository.insertOrderWalletFundingIntent).not.toHaveBeenCalled();
  });
});
