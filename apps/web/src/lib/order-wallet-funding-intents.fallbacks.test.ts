import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('createOrderWalletFundingIntent read-only account resolution', () => {
  beforeEach(() => {
    mockLoggerError.mockClear();
  });

  it('requires the dedicated funding-account consent flow when no account exists', async () => {
    const repository = createRepository({
      resolveWalletPaymentAccount: vi.fn(async () => null),
    });

    const result = await createOrderWalletFundingIntent({
      customer,
      merchant,
      orderId: 'order-1',
      repository,
      now: new Date('2026-05-26T12:00:00.000Z'),
    });

    expect(result).toEqual({
      code: 'WALLET_DVA_CONSENT_REQUIRED',
      kind: 'fallback',
    });
    expect(repository.insertOrderWalletFundingIntent).not.toHaveBeenCalled();
  });

  it('returns a setup fallback when the caller-scoped account read fails', async () => {
    const error = new Error('RLS account lookup unavailable');
    const repository = createRepository({
      resolveWalletPaymentAccount: vi.fn(() => {
        throw error;
      }),
    });

    const result = await createOrderWalletFundingIntent({
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
    expect(repository.insertOrderWalletFundingIntent).not.toHaveBeenCalled();
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to resolve wallet account for order funding intent',
        orderId: 'order-1',
      })
    );
  });
});
