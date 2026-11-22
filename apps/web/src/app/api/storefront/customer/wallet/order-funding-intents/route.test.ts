import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuthenticateApiRequest = vi.fn();
const mockCheckCsrfProtection = vi.fn();
const mockResolveWalletTopUpMerchant = vi.fn();
const mockResolveVtuCustomer = vi.fn();
const mockFetchPaystackSubaccountCode = vi.fn();
const mockCreateOrderWalletFundingIntent = vi.fn();
const mockAuthSupabase = { authScope: 'customer' };
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mockAuthenticateApiRequest(...args),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrfProtection(...args),
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
  createOrderWalletFundingIntent: (...args: unknown[]) =>
    mockCreateOrderWalletFundingIntent(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

import { POST } from './route';

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

const account = {
  accountName: 'Ogabassey/Jane Doe',
  accountNumber: '1234567890',
  bankName: 'Titan Paystack',
  provider: 'paystack',
};

const intent = {
  currency: 'NGN',
  expectedAmount: 15_000,
  expiresAt: '2026-05-26T12:30:00.000Z',
  fundedAmount: 0,
  id: 'intent-1',
  orderId: '11111111-1111-4111-8111-111111111111',
  status: 'pending',
  targetOrderAmount: 18_000,
};

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const VALID_BODY = { merchantSlug: 'ogabassey', orderId: ORDER_ID };

function postRequest(body: Record<string, unknown> = VALID_BODY) {
  return new NextRequest(
    'http://localhost:3000/api/storefront/customer/wallet/order-funding-intents',
    {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }
  );
}

function malformedJsonRequest() {
  return new NextRequest(
    'http://localhost:3000/api/storefront/customer/wallet/order-funding-intents',
    {
      body: '{invalid json}',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }
  );
}

describe('/api/storefront/customer/wallet/order-funding-intents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateApiRequest.mockResolvedValue({
      error: null,
      supabase: mockAuthSupabase,
      user: { email: 'jane@example.com', id: 'user-1' },
    });
    mockCheckCsrfProtection.mockResolvedValue({ response: null, valid: true });
    mockResolveWalletTopUpMerchant.mockResolvedValue(merchant);
    mockResolveVtuCustomer.mockResolvedValue(customer);
    mockFetchPaystackSubaccountCode.mockResolvedValue(
      merchant.paystack_subaccount_code
    );
    mockCreateOrderWalletFundingIntent.mockResolvedValue({
      account,
      intent,
      kind: 'intent',
    });
  });

  it('returns 401 before CSRF or database work when unauthenticated', async () => {
    mockAuthenticateApiRequest.mockResolvedValue({
      error: 'Unauthorized',
      supabase: null,
      user: null,
    });

    const response = await POST(postRequest());

    expect(response.status).toBe(401);
    expect(mockCheckCsrfProtection).not.toHaveBeenCalled();
    expect(mockCreateOrderWalletFundingIntent).not.toHaveBeenCalled();
  });

  it('returns the CSRF failure response before validating the body', async () => {
    mockCheckCsrfProtection.mockResolvedValue({
      response: NextResponse.json({ error: 'CSRF failed' }, { status: 403 }),
      valid: false,
    });

    const response = await POST(postRequest());

    expect(response.status).toBe(403);
    expect(mockResolveWalletTopUpMerchant).not.toHaveBeenCalled();
  });

  it('rejects invalid input before resolving merchant context', async () => {
    const response = await POST(
      postRequest({ amount: 15_000, merchantSlug: 'ogabassey', orderId: 'bad' })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ code: 'INVALID_INPUT', error: 'Invalid input' });
    expect(body.details).toBeUndefined();
    expect(mockResolveWalletTopUpMerchant).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before resolving merchant context', async () => {
    const response = await POST(malformedJsonRequest());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('MALFORMED_JSON');
    expect(mockResolveWalletTopUpMerchant).not.toHaveBeenCalled();
    expect(mockCreateOrderWalletFundingIntent).not.toHaveBeenCalled();
  });

  it('creates a wallet-funded order intent and returns reusable account details', async () => {
    const response = await POST(postRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockCreateOrderWalletFundingIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        customer,
        merchant,
        orderId: ORDER_ID,
        supabase: mockAuthSupabase,
      })
    );
    expect(body).toEqual({ account, intent });
  });

  it('maps disabled auto-debit to a typed 403 fallback', async () => {
    mockCreateOrderWalletFundingIntent.mockResolvedValue({
      code: 'WALLET_ORDER_AUTO_DEBIT_DISABLED',
      kind: 'fallback',
    });

    const response = await POST(postRequest());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe('WALLET_ORDER_AUTO_DEBIT_DISABLED');
  });

  it('returns a consent fallback when the customer has no wallet DVA yet', async () => {
    mockCreateOrderWalletFundingIntent.mockResolvedValue({
      code: 'WALLET_DVA_CONSENT_REQUIRED',
      kind: 'fallback',
    });

    const response = await POST(postRequest());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('WALLET_DVA_CONSENT_REQUIRED');
  });

  it.each([
    ['WALLET_DVA_DISABLED', 403],
    ['ORDER_NOT_FOUND', 404],
    ['WALLET_DVA_SETUP_FAILED', 502],
  ])('maps %s to a typed %i fallback', async (code, status) => {
    mockCreateOrderWalletFundingIntent.mockResolvedValue({
      code,
      kind: 'fallback',
    });

    const response = await POST(postRequest());
    const body = await response.json();

    expect(response.status).toBe(status);
    expect(body.code).toBe(code);
  });

  it('returns 404 when merchant context is missing', async () => {
    mockResolveWalletTopUpMerchant.mockResolvedValue(null);

    const response = await POST(
      postRequest({ merchantSlug: 'unknown', orderId: ORDER_ID })
    );

    expect(response.status).toBe(404);
    expect(mockResolveVtuCustomer).not.toHaveBeenCalled();
    expect(mockCreateOrderWalletFundingIntent).not.toHaveBeenCalled();
  });

  it('returns 409 for guest checkout customers', async () => {
    mockResolveVtuCustomer.mockResolvedValue(null);

    const response = await POST(postRequest());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('GUEST_CHECKOUT');
    expect(mockCreateOrderWalletFundingIntent).not.toHaveBeenCalled();
  });

  it('returns 500 when intent creation throws', async () => {
    mockCreateOrderWalletFundingIntent.mockRejectedValue(
      new Error('insert failed')
    );

    const response = await POST(postRequest());

    expect(response.status).toBe(500);
  });
});
