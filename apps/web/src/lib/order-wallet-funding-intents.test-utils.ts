import { vi } from 'vitest';
import type { OrderWalletFundingIntentStatus } from '@/lib/order-wallet-funding-intent-types';
import type { OrderWalletFundingIntentRepository } from '@/lib/order-wallet-funding-intents';

export const merchant = {
  business_name: 'Ogabassey',
  id: 'merchant-1',
  paystack_subaccount_code: 'ACCT_merchant123',
};

export const customer = {
  email: 'jane@example.com',
  first_name: 'Jane',
  id: 'customer-1',
  last_name: 'Doe',
  phone: '+2348012345678',
};

const walletAccount = {
  accountName: 'Ogabassey/Jane Doe',
  accountNumber: '1234567890',
  bankName: 'Titan Paystack',
  bankSlug: 'titan-paystack',
  consentedAt: '2026-05-21T10:00:00.000Z',
  currency: 'NGN' as const,
  customerId: 'customer-1',
  id: 'wallet-account-1',
  merchantId: 'merchant-1',
  metadata: {},
  provider: 'paystack' as const,
  providerAccountId: '99',
  providerCustomerCode: 'CUS_123',
  providerSubaccountCode: 'ACCT_merchant123',
  status: 'active' as const,
};

export const order = {
  currency: 'NGN',
  customerId: 'customer-1',
  id: 'order-1',
  merchantId: 'merchant-1',
  paymentStatus: 'pending',
  total: 20_000,
};

export function baseIntent() {
  return {
    createdAt: '2026-05-26T12:00:00.000Z',
    currency: 'NGN',
    customerId: 'customer-1',
    debitedAmount: 0,
    excessAmount: 0,
    expectedAmount: 15_000,
    expiresAt: '2026-05-26T12:30:00.000Z',
    fundedAmount: 0,
    id: 'intent-1',
    idempotencyKey: 'order-wallet-funding:order-1:test',
    lastGatewayReference: null,
    lastTransactionId: null,
    merchantId: 'merchant-1',
    orderId: 'order-1',
    provider: 'paystack' as const,
    status: 'pending' as OrderWalletFundingIntentStatus,
    targetOrderAmount: 18_000,
    walletBalanceSnapshot: 3_000,
    walletPaymentAccountId: 'wallet-account-1',
  };
}

export function intent(overrides: Partial<ReturnType<typeof baseIntent>> = {}) {
  return { ...baseIntent(), ...overrides };
}

export function createRepository(
  overrides: Partial<OrderWalletFundingIntentRepository> = {}
) {
  const repository: OrderWalletFundingIntentRepository = {
    expireStaleWalletFundingIntents: vi.fn(async () => undefined),
    findActiveOrderIntent: vi.fn(async () => null),
    findActiveWalletAccountIntents: vi.fn(async () => []),
    findWalletAccountIntentByTransferReference: vi.fn(async () => null),
    getOrderForCustomer: vi.fn(async () => order),
    getOrderWalletFundingIntent: vi.fn(async () => intent()),
    getPaymentSettings: vi.fn(async () => ({
      paystackEnabled: true,
      walletOrderAutoDebitEnabled: true,
      walletPaystackDvaEnabled: true,
    })),
    getSavingsRedeemedAmount: vi.fn(async () => 2_000),
    getWalletBalance: vi.fn(async () => 3_000),
    hasWalletOrderRedemption: vi.fn(async () => false),
    insertOrderWalletFundingIntent: vi.fn(async (payload) =>
      intent({
        customerId: payload.customerId,
        currency: payload.currency,
        expectedAmount: payload.expectedAmount,
        expiresAt: payload.expiresAt,
        merchantId: payload.merchantId,
        orderId: payload.orderId,
        targetOrderAmount: payload.targetOrderAmount,
        walletBalanceSnapshot: payload.walletBalanceSnapshot,
        walletPaymentAccountId: payload.walletPaymentAccountId,
      })
    ),
    markWalletFundingIntentReviewRequired: vi.fn(async () => undefined),
    resolveWalletPaymentAccount: vi.fn(async () => walletAccount),
    ...overrides,
  };

  return repository;
}
