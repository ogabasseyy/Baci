import { AuthSessionMissingError } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFrom, mockGetUser, mockResolveStorefrontAuthMerchant, mockRpc } =
  vi.hoisted(() => ({
    mockFrom: vi.fn(),
    mockGetUser: vi.fn(),
    mockResolveStorefrontAuthMerchant: vi.fn(),
    mockRpc: vi.fn(),
  }));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
    rpc: mockRpc,
  })),
}));

vi.mock('../resolve-storefront-auth-merchant', () => ({
  resolveStorefrontAuthMerchant: (...args: unknown[]) =>
    mockResolveStorefrontAuthMerchant(...args),
}));

import { GET } from './route';

function makeRequest(merchantSlug = 'ogabassey') {
  return new Request(
    `https://example.com/api/storefront/auth/session?merchantSlug=${merchantSlug}`
  );
}

function makeSelectChain(result: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    single: vi.fn().mockResolvedValue(result),
  };

  return chain;
}

function makeInsertChain(result: { data: unknown; error: unknown }) {
  const chain = {
    insert: vi.fn(() => chain),
    select: vi.fn(() => chain),
    single: vi.fn().mockResolvedValue(result),
  };

  return chain;
}

function makeUpdateChain(result: { data: unknown; error: unknown }) {
  const chain = {
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    select: vi.fn(() => chain),
    single: vi.fn().mockResolvedValue(result),
  };

  return chain;
}

const merchant = { id: 'merchant-1' };
const user = {
  id: 'user-1',
  email: 'customer@example.com',
  user_metadata: {
    first_name: 'Ada',
    last_name: 'Lovelace',
    phone: '+2348000000000',
    role: 'customer',
  },
};
const customer = {
  id: 'customer-1',
  first_name: 'Ada',
  last_name: 'Lovelace',
  email: 'customer@example.com',
  phone: '+2348000000000',
  address: null,
  saved_addresses: [],
  store_credit: 0,
  total_orders: 0,
  total_spent: 0,
  created_at: '2026-05-20T00:00:00.000Z',
};

describe('GET /api/storefront/auth/session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveStorefrontAuthMerchant.mockResolvedValue(merchant);
    mockRpc.mockResolvedValue({ data: 'customer-1', error: null });
  });

  it('returns an anonymous session when there is no authenticated user', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      authenticated: false,
      user: null,
      customer: null,
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns an anonymous session when getUser reports AuthSessionMissingError', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: new AuthSessionMissingError(),
    });

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      authenticated: false,
      user: null,
      customer: null,
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns 503 on transient auth lookup failures instead of authenticated: false', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { name: 'AuthRetryableFetchError', message: 'upstream timeout' },
    });

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ error: 'Session lookup failed' });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns 400 when merchantSlug is missing', async () => {
    const response = await GET(
      new Request('https://example.com/api/storefront/auth/session')
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Merchant slug is required' });
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('does not treat merchant accounts as storefront customers', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          ...user,
          user_metadata: { ...user.user_metadata, role: 'merchant' },
        },
      },
      error: null,
    });

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      authenticated: false,
      user: null,
      customer: null,
      reason: 'merchant_account',
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns 404 when the merchant cannot be found', async () => {
    mockGetUser.mockResolvedValue({
      data: { user },
      error: null,
    });
    mockResolveStorefrontAuthMerchant.mockResolvedValue(null);

    const response = await GET(makeRequest('nonexistent'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Store not found' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('uses the secure customer auth upsert when the user has no customer row yet', async () => {
    mockGetUser.mockResolvedValue({
      data: { user },
      error: null,
    });

    const missingCustomerChain = makeSelectChain({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });
    const linkedCustomerChain = makeSelectChain({
      data: customer,
      error: null,
    });

    let customerLookupCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'customers') {
        customerLookupCount += 1;
        return customerLookupCount === 1
          ? missingCustomerChain
          : linkedCustomerChain;
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('upsert_customer_on_auth', {
      p_merchant_id: 'merchant-1',
      p_user_id: 'user-1',
      p_email: 'customer@example.com',
      p_full_name: 'Ada Lovelace',
      p_phone: '+2348000000000',
    });
    expect(body.customer).toEqual(customer);
  });

  it('claims phone-auth customer sessions without calling the email-checked RPC', async () => {
    const phoneOnlyUser = {
      ...user,
      email: undefined,
      phone: '+2348000000000',
      user_metadata: {
        first_name: 'Ada',
        last_name: 'Lovelace',
        role: 'customer',
      },
    };

    mockGetUser.mockResolvedValue({
      data: { user: phoneOnlyUser },
      error: null,
    });

    const missingCustomerChain = makeSelectChain({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });
    const claimedCustomerChain = makeSelectChain({
      data: { ...customer, email: null },
      error: null,
    });

    let customerLookupCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'customers') {
        customerLookupCount += 1;
        return customerLookupCount === 1
          ? missingCustomerChain
          : claimedCustomerChain;
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('claim_customer_on_phone_auth', {
      p_first_name: 'Ada',
      p_last_name: 'Lovelace',
      p_merchant_id: 'merchant-1',
      p_phone: '+2348000000000',
      p_user_id: 'user-1',
    });
    expect(claimedCustomerChain.eq).toHaveBeenCalledWith('id', 'customer-1');
    expect(claimedCustomerChain.eq).toHaveBeenCalledWith(
      'merchant_id',
      'merchant-1'
    );
    expect(claimedCustomerChain.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(body).toEqual({
      authenticated: true,
      customer: { ...customer, email: null },
      user: {
        email: null,
        id: 'user-1',
        role: 'customer',
      },
    });
  });

  it('uses direct no-email customer creation when only metadata phone is available', async () => {
    const metadataPhoneUser = {
      ...user,
      email: undefined,
      user_metadata: {
        ...user.user_metadata,
        role: 'customer',
      },
    };

    mockGetUser.mockResolvedValue({
      data: { user: metadataPhoneUser },
      error: null,
    });

    const missingCustomerChain = makeSelectChain({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });
    const insertCustomerChain = makeInsertChain({
      data: { ...customer, email: null },
      error: null,
    });

    let customerLookupCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'customers') {
        customerLookupCount += 1;
        return customerLookupCount === 1
          ? missingCustomerChain
          : insertCustomerChain;
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(insertCustomerChain.insert).toHaveBeenCalledWith({
      email: null,
      first_name: 'Ada',
      last_name: 'Lovelace',
      merchant_id: 'merchant-1',
      phone: '+2348000000000',
      user_id: 'user-1',
    });
    expect(body.customer).toEqual({ ...customer, email: null });
  });

  it('falls back to direct no-email customer creation when there is no verified phone', async () => {
    const noIdentifierUser = {
      ...user,
      email: undefined,
      user_metadata: {
        first_name: 'Ada',
        last_name: 'Lovelace',
        role: 'customer',
      },
    };

    mockGetUser.mockResolvedValue({
      data: { user: noIdentifierUser },
      error: null,
    });

    const missingCustomerChain = makeSelectChain({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });
    const insertCustomerChain = makeInsertChain({
      data: { ...customer, email: null, phone: null },
      error: null,
    });

    let customerLookupCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'customers') {
        customerLookupCount += 1;
        return customerLookupCount === 1
          ? missingCustomerChain
          : insertCustomerChain;
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(insertCustomerChain.insert).toHaveBeenCalledWith({
      email: null,
      first_name: 'Ada',
      last_name: 'Lovelace',
      merchant_id: 'merchant-1',
      phone: null,
      user_id: 'user-1',
    });
    expect(body.customer).toEqual({ ...customer, email: null, phone: null });
  });

  it('preserves split names when the secure customer auth upsert links a row without them', async () => {
    mockGetUser.mockResolvedValue({
      data: { user },
      error: null,
    });

    const missingCustomerChain = makeSelectChain({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });
    const linkedCustomerWithoutNamesChain = makeSelectChain({
      data: { ...customer, first_name: null, last_name: null },
      error: null,
    });
    const updateCustomerNamesChain = makeUpdateChain({
      data: customer,
      error: null,
    });

    let customerLookupCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'customers') {
        customerLookupCount += 1;
        if (customerLookupCount === 1) return missingCustomerChain;
        if (customerLookupCount === 2) return linkedCustomerWithoutNamesChain;
        return updateCustomerNamesChain;
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('upsert_customer_on_auth', {
      p_merchant_id: 'merchant-1',
      p_user_id: 'user-1',
      p_email: 'customer@example.com',
      p_full_name: 'Ada Lovelace',
      p_phone: '+2348000000000',
    });
    expect(updateCustomerNamesChain.update).toHaveBeenCalledWith({
      first_name: 'Ada',
      last_name: 'Lovelace',
    });
    expect(body.customer).toEqual(customer);
  });

  it('does not upsert when the authenticated customer row already exists', async () => {
    mockGetUser.mockResolvedValue({
      data: { user },
      error: null,
    });

    const customerChain = makeSelectChain({ data: customer, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'customers') return customerChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(body.customer).toEqual(customer);
  });

  it('returns 500 when session lookup throws unexpectedly', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockGetUser.mockResolvedValue({
      data: { user },
      error: null,
    });
    mockFrom.mockImplementation(() => {
      throw new Error('database unavailable');
    });

    try {
      const response = await GET(makeRequest());
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toEqual({ error: 'Internal server error' });
    } finally {
      consoleError.mockRestore();
    }
  });
});
