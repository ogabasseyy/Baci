import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerWalletPaymentAccountError } from '@/lib/customer-wallet-payment-accounts';
import { logger } from '@/lib/logger';
import { createOrderWalletFundingIntent } from '@/lib/order-wallet-funding-intents';
import {
  createRepository,
  customer,
  intent,
  merchant,
  order,
} from '@/lib/order-wallet-funding-intents.test-utils';

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

describe('createOrderWalletFundingIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an intent using an existing wallet DVA and subtracts savings plus wallet balance from the transfer amount', async () => {
    const repository = createRepository();

    const result = await createOrderWalletFundingIntent({
      customer,
      merchant,
      orderId: 'order-1',
      repository,
      now: new Date('2026-05-26T12:00:00.000Z'),
    });

    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') throw new Error('expected intent');
    expect(result.intent.targetOrderAmount).toBe(18_000);
    expect(result.intent.expectedAmount).toBe(15_000);
    expect(result.intent.walletBalanceSnapshot).toBe(3_000);
    expect(result.account.accountNumber).toBe('1234567890');
    expect(repository.insertOrderWalletFundingIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedAmount: 15_000,
        targetOrderAmount: 18_000,
        walletBalanceSnapshot: 3_000,
      })
    );
  });

  it('requires explicit consent before provisioning a missing wallet DVA', async () => {
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

  it('falls back without inserting when wallet account resolution requires a customer phone number', async () => {
    const repository = createRepository({
      resolveWalletPaymentAccount: vi.fn(() => {
        throw new CustomerWalletPaymentAccountError(
          'CUSTOMER_PHONE_REQUIRED',
          'Customer phone number is required'
        );
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
      code: 'CUSTOMER_PHONE_REQUIRED',
      kind: 'fallback',
    });
    expect(repository.insertOrderWalletFundingIntent).not.toHaveBeenCalled();
  });

  it('falls back and logs when wallet account resolution fails unexpectedly', async () => {
    const error = new Error('DVA provider unavailable');
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
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'customer-1',
        error,
        merchantId: 'merchant-1',
        orderId: 'order-1',
      })
    );
  });

  it('reuses a non-terminal intent for the same order instead of inserting again', async () => {
    const existingIntent = intent({ id: 'intent-existing' });
    const repository = createRepository({
      findActiveOrderIntent: vi.fn(async () => existingIntent),
    });

    const result = await createOrderWalletFundingIntent({
      customer,
      merchant,
      orderId: 'order-1',
      repository,
      now: new Date('2026-05-26T12:00:00.000Z'),
    });

    expect(result.kind).toBe('intent');
    if (result.kind !== 'intent') throw new Error('expected intent');
    expect(result.intent.id).toBe('intent-existing');
    expect(repository.insertOrderWalletFundingIntent).not.toHaveBeenCalled();
  });

  it('falls back to wallet-only payment when the current wallet balance covers the residual order amount', async () => {
    const repository = createRepository({
      getWalletBalance: vi.fn(async () => 25_000),
    });

    const result = await createOrderWalletFundingIntent({
      customer,
      merchant,
      orderId: 'order-1',
      repository,
      now: new Date('2026-05-26T12:00:00.000Z'),
    });

    expect(result).toEqual({
      code: 'WALLET_BALANCE_COVERS_ORDER',
      kind: 'fallback',
      targetOrderAmount: 18_000,
      walletBalance: 25_000,
    });
    expect(repository.insertOrderWalletFundingIntent).not.toHaveBeenCalled();
  });

  it('refuses to create an intent when the order already has a wallet redemption', async () => {
    const repository = createRepository({
      hasWalletOrderRedemption: vi.fn(async () => true),
    });

    const result = await createOrderWalletFundingIntent({
      customer,
      merchant,
      orderId: 'order-1',
      repository,
      now: new Date('2026-05-26T12:00:00.000Z'),
    });

    expect(result).toEqual({
      code: 'ORDER_ALREADY_HAS_WALLET_REDEMPTION',
      kind: 'fallback',
    });
    expect(repository.insertOrderWalletFundingIntent).not.toHaveBeenCalled();
  });

  it('refuses paid orders before inserting an intent', async () => {
    const repository = createRepository({
      getOrderForCustomer: vi.fn(async () => ({
        ...order,
        paymentStatus: 'paid',
      })),
    });

    const result = await createOrderWalletFundingIntent({
      customer,
      merchant,
      orderId: 'order-1',
      repository,
      now: new Date('2026-05-26T12:00:00.000Z'),
    });

    expect(result).toEqual({ code: 'ORDER_NOT_PAYABLE', kind: 'fallback' });
    expect(repository.findActiveOrderIntent).not.toHaveBeenCalled();
    expect(repository.insertOrderWalletFundingIntent).not.toHaveBeenCalled();
  });

  it('returns order not found without inserting when the order is outside the customer scope', async () => {
    const repository = createRepository({
      getOrderForCustomer: vi.fn(async () => null),
    });

    const result = await createOrderWalletFundingIntent({
      customer,
      merchant,
      orderId: 'order-1',
      repository,
      now: new Date('2026-05-26T12:00:00.000Z'),
    });

    expect(result).toEqual({ code: 'ORDER_NOT_FOUND', kind: 'fallback' });
    expect(repository.findActiveOrderIntent).not.toHaveBeenCalled();
    expect(repository.insertOrderWalletFundingIntent).not.toHaveBeenCalled();
  });

  it('does not reuse an active intent when the order is no longer payable', async () => {
    const repository = createRepository({
      findActiveOrderIntent: vi.fn(async () => intent({ id: 'intent-stale' })),
      getOrderForCustomer: vi.fn(async () => ({
        ...order,
        paymentStatus: 'paid',
      })),
    });

    const result = await createOrderWalletFundingIntent({
      customer,
      merchant,
      orderId: 'order-1',
      repository,
      now: new Date('2026-05-26T12:00:00.000Z'),
    });

    expect(result).toEqual({ code: 'ORDER_NOT_PAYABLE', kind: 'fallback' });
    expect(repository.findActiveOrderIntent).not.toHaveBeenCalled();
    expect(repository.insertOrderWalletFundingIntent).not.toHaveBeenCalled();
  });

  it('does not reuse an active intent when the order already has wallet redemption', async () => {
    const repository = createRepository({
      findActiveOrderIntent: vi.fn(async () => intent({ id: 'intent-stale' })),
      hasWalletOrderRedemption: vi.fn(async () => true),
    });

    const result = await createOrderWalletFundingIntent({
      customer,
      merchant,
      orderId: 'order-1',
      repository,
      now: new Date('2026-05-26T12:00:00.000Z'),
    });

    expect(result).toEqual({
      code: 'ORDER_ALREADY_HAS_WALLET_REDEMPTION',
      kind: 'fallback',
    });
    expect(repository.findActiveOrderIntent).not.toHaveBeenCalled();
    expect(repository.insertOrderWalletFundingIntent).not.toHaveBeenCalled();
  });
});
