import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuthenticateApiRequest = vi.fn();
const mockCheckCsrfProtection = vi.fn();
const mockResolveVtuCustomer = vi.fn();
const mockResolveWalletTopUpMerchant = vi.fn();
const mockResolveCustomerWalletPaymentAccount = vi.fn();
const mockEnsureCustomerWalletPaymentAccount = vi.fn();
const mockFetchPaystackSubaccountCode = vi.fn();
const mockRpc = vi.fn();
const mockCreateWalletDvaAccountWriter = vi.fn();
const mockWalletDvaWriter = vi.fn();

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

vi.mock('@/lib/vtu-pending-transaction', () => ({
  resolveVtuCustomer: (...args: unknown[]) => mockResolveVtuCustomer(...args),
}));

vi.mock('@/lib/customer-wallet-payment-accounts', () => ({
  CustomerWalletPaymentAccountError: class CustomerWalletPaymentAccountError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.name = 'CustomerWalletPaymentAccountError';
      this.code = code;
    }
  },
  ensureCustomerWalletPaymentAccount: (...args: unknown[]) =>
    mockEnsureCustomerWalletPaymentAccount(...args),
  resolveCustomerWalletPaymentAccount: (...args: unknown[]) =>
    mockResolveCustomerWalletPaymentAccount(...args),
}));

vi.mock('@/lib/fetch-merchant-payment-secret', () => ({
  fetchMerchantPaystackSubaccountCode: (...args: unknown[]) =>
    mockFetchPaystackSubaccountCode(...args),
}));

vi.mock('@/lib/wallet-dva-provisioner', () => ({
  createWalletDvaAccountWriter: (...args: unknown[]) =>
    mockCreateWalletDvaAccountWriter(...args),
}));

import { CustomerWalletPaymentAccountError } from '@/lib/customer-wallet-payment-accounts';
import { GET, POST } from './route';
import {
  customer,
  getRequest,
  merchant,
  postRequest,
  walletAccount,
} from './route.test-utils';

describe('/api/storefront/customer/wallet/funding-account', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateApiRequest.mockResolvedValue({
      error: null,
      supabase: { authScope: 'customer', rpc: mockRpc },
      user: { id: 'user-1', email: 'jane@example.com' },
    });
    mockCheckCsrfProtection.mockResolvedValue({ valid: true, response: null });
    mockResolveWalletTopUpMerchant.mockResolvedValue(merchant);
    mockResolveVtuCustomer.mockResolvedValue(customer);
    mockFetchPaystackSubaccountCode.mockResolvedValue(
      merchant.paystack_subaccount_code
    );
    mockResolveCustomerWalletPaymentAccount.mockResolvedValue(walletAccount);
    mockEnsureCustomerWalletPaymentAccount.mockResolvedValue(walletAccount);
    mockCreateWalletDvaAccountWriter.mockReturnValue(mockWalletDvaWriter);
    mockRpc.mockResolvedValue({ data: true, error: null });
  });

  it('returns 401 before database work when the customer is not authenticated', async () => {
    mockAuthenticateApiRequest.mockResolvedValue({
      error: 'Not authenticated',
      supabase: null,
      user: null,
    });

    const response = await GET(
      getRequest(
        'http://localhost:3000/api/storefront/customer/wallet/funding-account?merchantSlug=ogabassey'
      )
    );

    expect(response.status).toBe(401);
    expect(mockResolveWalletTopUpMerchant).not.toHaveBeenCalled();
  });

  it('returns an existing active funding account on GET', async () => {
    const response = await GET(
      getRequest(
        'http://localhost:3000/api/storefront/customer/wallet/funding-account?merchantSlug=ogabassey'
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      account: {
        accountName: 'Ogabassey/Jane Doe',
        accountNumber: '1234567890',
        bankName: 'Titan Paystack',
        provider: 'paystack',
      },
      requiresConsent: false,
    });
    // Identity is resolved on the caller's authenticated RLS client with
    // non-secret columns, so an unpublished merchant is indistinguishable from a
    // nonexistent one (no tenant existence oracle). The revoked
    // paystack_subaccount_code is read via the bounded RPC after ownership is verified.
    expect(mockResolveWalletTopUpMerchant).toHaveBeenCalledWith(
      expect.objectContaining({ authScope: 'customer' }),
      expect.anything(),
      'id, slug, business_name'
    );
    expect(mockFetchPaystackSubaccountCode).toHaveBeenCalledWith(
      expect.objectContaining({ authScope: 'customer' }),
      'merchant-1'
    );
    // Customer resolution stays on the authenticated RLS client.
    expect(mockResolveVtuCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        supabase: expect.objectContaining({ authScope: 'customer' }),
      })
    );
  });

  it('returns requiresConsent when no wallet DVA exists yet', async () => {
    mockResolveCustomerWalletPaymentAccount.mockResolvedValue(null);

    const response = await GET(
      getRequest(
        'http://localhost:3000/api/storefront/customer/wallet/funding-account?merchantSlug=ogabassey'
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ account: null, requiresConsent: true });
  });

  it('returns 500 when funding account lookup throws unexpectedly', async () => {
    mockResolveCustomerWalletPaymentAccount.mockRejectedValue(
      new Error('account lookup unavailable')
    );

    const response = await GET(
      getRequest(
        'http://localhost:3000/api/storefront/customer/wallet/funding-account?merchantSlug=ogabassey'
      )
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to fetch wallet funding account' });
  });

  it('requires a merchant identifier', async () => {
    const response = await GET(
      getRequest(
        'http://localhost:3000/api/storefront/customer/wallet/funding-account'
      )
    );

    expect(response.status).toBe(400);
  });

  it('creates a funding account on POST after CSRF and consent validation', async () => {
    const response = await POST(
      postRequest({
        consent: true,
        merchantSlug: 'ogabassey',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockCheckCsrfProtection).toHaveBeenCalled();
    expect(mockEnsureCustomerWalletPaymentAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        customer,
        merchant,
        supabase: expect.objectContaining({ authScope: 'customer' }),
        userId: 'user-1',
        walletDvaWriter: mockWalletDvaWriter,
      })
    );
    expect(mockRpc).toHaveBeenCalledWith('get_customer_wallet_dva_enabled', {
      p_customer_id: 'customer-1',
      p_merchant_id: 'merchant-1',
    });
    expect(body.requiresConsent).toBe(false);
    expect(body.account.accountNumber).toBe('1234567890');
  });

  it('returns 400 when POST receives malformed JSON', async () => {
    const response = await POST(
      new NextRequest(
        'http://localhost:3000/api/storefront/customer/wallet/funding-account',
        {
          body: '{',
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        }
      )
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: 'MALFORMED_JSON',
      error: 'Malformed JSON',
    });
    expect(mockResolveWalletTopUpMerchant).not.toHaveBeenCalled();
  });

  it('returns 401 on POST before CSRF and DVA creation when unauthenticated', async () => {
    mockAuthenticateApiRequest.mockResolvedValue({
      error: 'Unauthorized',
      supabase: null,
      user: null,
    });

    const response = await POST(
      postRequest({
        consent: true,
        merchantSlug: 'ogabassey',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
    expect(mockCheckCsrfProtection).not.toHaveBeenCalled();
    expect(mockEnsureCustomerWalletPaymentAccount).not.toHaveBeenCalled();
  });

  it('blocks POST when the merchant wallet DVA flag is disabled', async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });

    const response = await POST(
      postRequest({ consent: true, merchantSlug: 'ogabassey' })
    );

    expect(response.status).toBe(403);
    expect(mockEnsureCustomerWalletPaymentAccount).not.toHaveBeenCalled();
  });

  it('maps customer phone requirement to a 400 response', async () => {
    mockEnsureCustomerWalletPaymentAccount.mockRejectedValue(
      new CustomerWalletPaymentAccountError(
        'CUSTOMER_PHONE_REQUIRED',
        'Add a phone number before creating a wallet transfer account'
      )
    );

    const response = await POST(
      postRequest({ consent: true, merchantSlug: 'ogabassey' })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('CUSTOMER_PHONE_REQUIRED');
  });

  it('returns 500 when POST DVA creation fails unexpectedly', async () => {
    mockEnsureCustomerWalletPaymentAccount.mockRejectedValue(new Error('boom'));

    const response = await POST(
      postRequest({ consent: true, merchantSlug: 'ogabassey' })
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to create wallet funding account' });
  });
});
