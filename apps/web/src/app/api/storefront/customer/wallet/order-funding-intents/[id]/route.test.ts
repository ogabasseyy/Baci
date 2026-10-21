import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuthenticateApiRequest = vi.fn();
const mockResolveWalletTopUpMerchant = vi.fn();
const mockResolveVtuCustomer = vi.fn();
const mockFetchPaystackSubaccountCode = vi.fn();
const mockGetOrderWalletFundingIntent = vi.fn();
const mockExpireStaleWalletFundingIntents = vi.fn();

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mockAuthenticateApiRequest(...args),
}));

vi.mock('@/lib/resolve-wallet-top-up-merchant', () => ({
  resolveWalletTopUpMerchant: (...args: unknown[]) =>
    mockResolveWalletTopUpMerchant(...args),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ role: 'service-role' })),
}));

vi.mock('@/lib/fetch-merchant-payment-secret', () => ({
  fetchMerchantPaystackSubaccountCode: (...args: unknown[]) =>
    mockFetchPaystackSubaccountCode(...args),
}));

vi.mock('@/lib/vtu-pending-transaction', () => ({
  resolveVtuCustomer: (...args: unknown[]) => mockResolveVtuCustomer(...args),
}));

vi.mock('@/lib/order-wallet-funding-intents', () => ({
  expireStaleWalletFundingIntents: (...args: unknown[]) =>
    mockExpireStaleWalletFundingIntents(...args),
  getOrderWalletFundingIntent: (...args: unknown[]) =>
    mockGetOrderWalletFundingIntent(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

import { orderWalletFundingIntentPollResponseFixture } from '@baci/shared/test-fixtures/order-wallet-funding-intent';
import { GET } from './route';

const merchant = {
  business_name: 'Ogabassey',
  id: 'merchant-1',
  paystack_subaccount_code: 'ACCT_merchant123',
  slug: 'ogabassey',
};

const customer = {
  email: 'jane@example.com',
  first_name: 'Jane',
  id: 'customer-1',
  last_name: 'Doe',
  phone: '+2348012345678',
};

const intentId = '11111111-1111-4111-8111-111111111111';
const orderId = '22222222-2222-4222-8222-222222222222';

const intent = {
  currency: 'NGN',
  debitedAmount: 0,
  expectedAmount: 15_000,
  excessAmount: 0,
  expiresAt: '2026-05-26T12:30:00.000Z',
  fundedAmount: 10_000,
  id: intentId,
  orderId,
  status: 'pending',
  targetOrderAmount: 18_000,
};

function getRequest(url: string) {
  return new NextRequest(url);
}

describe('/api/storefront/customer/wallet/order-funding-intents/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateApiRequest.mockResolvedValue({
      error: null,
      supabase: { authScope: 'customer' },
      user: { email: 'jane@example.com', id: 'user-1' },
    });
    mockResolveWalletTopUpMerchant.mockResolvedValue(merchant);
    mockResolveVtuCustomer.mockResolvedValue(customer);
    mockFetchPaystackSubaccountCode.mockResolvedValue(
      merchant.paystack_subaccount_code
    );
    mockExpireStaleWalletFundingIntents.mockResolvedValue(undefined);
    mockGetOrderWalletFundingIntent.mockResolvedValue(intent);
  });

  it('returns 401 before database work when unauthenticated', async () => {
    mockAuthenticateApiRequest.mockResolvedValue({
      error: 'Unauthorized',
      supabase: null,
      user: null,
    });

    const response = await GET(
      getRequest(
        `http://localhost:3000/api/storefront/customer/wallet/order-funding-intents/${intentId}?merchantSlug=ogabassey`
      ),
      { params: Promise.resolve({ id: intentId }) }
    );

    expect(response.status).toBe(401);
    expect(mockGetOrderWalletFundingIntent).not.toHaveBeenCalled();
  });

  it('rejects a missing merchant identifier', async () => {
    const response = await GET(
      getRequest(
        `http://localhost:3000/api/storefront/customer/wallet/order-funding-intents/${intentId}`
      ),
      { params: Promise.resolve({ id: intentId }) }
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ code: 'INVALID_QUERY', error: 'Invalid query' });
    expect(body.details).toBeUndefined();
    expect(mockResolveWalletTopUpMerchant).not.toHaveBeenCalled();
  });

  it('rejects an invalid intent id before merchant or database work', async () => {
    const response = await GET(
      getRequest(
        'http://localhost:3000/api/storefront/customer/wallet/order-funding-intents/not-a-uuid?merchantSlug=ogabassey'
      ),
      { params: Promise.resolve({ id: 'not-a-uuid' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      code: 'INVALID_INTENT_ID',
      error: 'Invalid intent id',
    });
    expect(mockResolveWalletTopUpMerchant).not.toHaveBeenCalled();
    expect(mockExpireStaleWalletFundingIntents).not.toHaveBeenCalled();
    expect(mockGetOrderWalletFundingIntent).not.toHaveBeenCalled();
  });

  it('characterizes the poll response shape (offset-form expiresAt)', async () => {
    mockGetOrderWalletFundingIntent.mockResolvedValue({
      currency: 'NGN',
      debitedAmount: 0,
      excessAmount: 0,
      expectedAmount: 5000,
      expiresAt: '2026-05-21T11:00:00+00:00',
      fundedAmount: 0,
      id: intentId,
      orderId,
      status: 'pending',
      targetOrderAmount: 5000,
    });

    const response = await GET(
      getRequest(
        `http://localhost:3000/api/storefront/customer/wallet/order-funding-intents/${intentId}?merchantSlug=ogabassey`
      ),
      { params: Promise.resolve({ id: intentId }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      orderWalletFundingIntentPollResponseFixture
    );
  });

  it('returns the scoped intent for the authenticated customer', async () => {
    const response = await GET(
      getRequest(
        `http://localhost:3000/api/storefront/customer/wallet/order-funding-intents/${intentId}?merchantSlug=ogabassey`
      ),
      { params: Promise.resolve({ id: intentId }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockExpireStaleWalletFundingIntents).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'customer-1',
        merchantId: 'merchant-1',
      })
    );
    expect(mockGetOrderWalletFundingIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'customer-1',
        id: intentId,
        merchantId: 'merchant-1',
      })
    );
    expect(body.intent).toEqual({
      ...intent,
      orderPaid: false,
      remainingAmount: 5000,
    });
  });

  it('returns 404 when the intent is not scoped to the customer', async () => {
    mockGetOrderWalletFundingIntent.mockResolvedValue(null);

    const response = await GET(
      getRequest(
        `http://localhost:3000/api/storefront/customer/wallet/order-funding-intents/${intentId}?merchantSlug=ogabassey`
      ),
      { params: Promise.resolve({ id: intentId }) }
    );

    expect(response.status).toBe(404);
  });

  it('returns 404 when the merchant cannot be resolved', async () => {
    mockResolveWalletTopUpMerchant.mockResolvedValue(null);

    const response = await GET(
      getRequest(
        `http://localhost:3000/api/storefront/customer/wallet/order-funding-intents/${intentId}?merchantSlug=missing`
      ),
      { params: Promise.resolve({ id: intentId }) }
    );

    expect(response.status).toBe(404);
    expect(mockResolveVtuCustomer).not.toHaveBeenCalled();
    expect(mockGetOrderWalletFundingIntent).not.toHaveBeenCalled();
  });

  it('returns 409 for guest checkout customers', async () => {
    mockResolveVtuCustomer.mockResolvedValue(null);

    const response = await GET(
      getRequest(
        `http://localhost:3000/api/storefront/customer/wallet/order-funding-intents/${intentId}?merchantSlug=ogabassey`
      ),
      { params: Promise.resolve({ id: intentId }) }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('GUEST_CHECKOUT');
    expect(mockGetOrderWalletFundingIntent).not.toHaveBeenCalled();
  });

  it('returns 500 when expiring stale intents fails', async () => {
    mockExpireStaleWalletFundingIntents.mockRejectedValue(
      new Error('rpc failed')
    );

    const response = await GET(
      getRequest(
        `http://localhost:3000/api/storefront/customer/wallet/order-funding-intents/${intentId}?merchantSlug=ogabassey`
      ),
      { params: Promise.resolve({ id: intentId }) }
    );

    expect(response.status).toBe(500);
    expect(mockGetOrderWalletFundingIntent).not.toHaveBeenCalled();
  });

  it('returns 500 when polling the intent fails', async () => {
    mockGetOrderWalletFundingIntent.mockRejectedValue(
      new Error('query failed')
    );

    const response = await GET(
      getRequest(
        `http://localhost:3000/api/storefront/customer/wallet/order-funding-intents/${intentId}?merchantSlug=ogabassey`
      ),
      { params: Promise.resolve({ id: intentId }) }
    );

    expect(response.status).toBe(500);
  });
});
