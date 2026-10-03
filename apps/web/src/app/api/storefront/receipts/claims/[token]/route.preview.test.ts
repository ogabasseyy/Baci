import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashReceiptClaimToken } from '@/lib/import-notifications/receipt-claim-links';

const mockAuthenticateApiRequest = vi.fn();
const mockCheckCsrfProtection = vi.fn();
const mockCreateClient = vi.fn();
const mockConsoleError = vi
  .spyOn(console, 'error')
  .mockImplementation(() => undefined);

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mockAuthenticateApiRequest(...args),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrfProtection(...args),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockCreateClient(),
}));

import { GET } from './route';

const baseClaim = {
  claimed_at: null,
  claimed_by_user_id: null,
  customer_email: 'basseybjohn@yahoo.co.uk',
  customer_id: 'customer-1',
  customer_name: 'Bassey John',
  expires_at: '2099-01-01T00:00:00.000Z',
  id: 'claim-1',
  merchant_id: 'merchant-1',
  merchant: {
    business_name: 'Ogabassey',
    slug: 'ogabassey',
  },
  orders: [
    {
      id: 'order-1',
      order_items: [{ name: 'iPhone 16 Pro Max', quantity: 1 }],
      order_number: '06485',
    },
    {
      id: 'order-2',
      order_items: [{ name: 'AirPods Pro', quantity: 2 }],
      order_number: '06484',
    },
  ],
};

function createSupabaseRpcMock(
  response: { data: unknown; error: unknown },
  trackingResponse: { data: unknown; error: unknown } = {
    data: null,
    error: null,
  }
) {
  return {
    rpc: vi.fn((name: string) => {
      if (name === 'preview_receipt_claim') {
        return Promise.resolve(response);
      }

      if (name === 'record_receipt_claim_click_v2') {
        return Promise.resolve(trackingResponse);
      }

      return Promise.resolve({
        data: null,
        error: { message: `Unexpected RPC: ${name}` },
      });
    }),
  };
}

function getRequest() {
  return new NextRequest(
    'http://localhost:3000/api/storefront/receipts/claims/claim-token'
  );
}

const params = { params: Promise.resolve({ token: 'claim-token' }) };
const invalidParams = { params: Promise.resolve({ token: 'bad token' }) };

describe('GET /api/storefront/receipts/claims/[token]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConsoleError.mockClear();
  });

  it('returns 400 for invalid claim tokens', async () => {
    const response = await GET(getRequest(), invalidParams);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Invalid receipt claim link' });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('returns claim preview details for a valid token', async () => {
    const supabase = createSupabaseRpcMock({ data: baseClaim, error: null });
    mockCreateClient.mockResolvedValue(supabase);

    const response = await GET(getRequest(), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith('preview_receipt_claim', {
      p_token_hash: hashReceiptClaimToken('claim-token'),
    });
    expect(supabase.rpc).toHaveBeenCalledWith('record_receipt_claim_click_v2', {
      p_source: 'web',
      p_token_hash: hashReceiptClaimToken('claim-token'),
    });
    expect(body).toMatchObject({
      claim: {
        claimed: false,
        customerName: 'Bassey John',
        devices: ['iPhone 16 Pro Max', '2 x AirPods Pro'],
        merchantName: 'Ogabassey',
      },
    });
    expect(body.claim).not.toHaveProperty('customerEmail');
  });

  it('still returns claim preview details when click tracking fails', async () => {
    const supabase = createSupabaseRpcMock(
      { data: baseClaim, error: null },
      { data: null, error: { message: 'tracking write failed' } }
    );
    mockCreateClient.mockResolvedValue(supabase);

    const response = await GET(getRequest(), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.claim.customerName).toBe('Bassey John');
    expect(mockConsoleError).toHaveBeenCalled();
  });

  it('uses a generic merchant fallback when the claim merchant has no name', async () => {
    const supabase = createSupabaseRpcMock({
      data: {
        ...baseClaim,
        merchant: { business_name: null, slug: null },
      },
      error: null,
    });
    mockCreateClient.mockResolvedValue(supabase);

    const response = await GET(getRequest(), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.claim.merchantName).toBe('Store');
  });

  it('returns 404 when the receipt claim is not found', async () => {
    const supabase = createSupabaseRpcMock({ data: null, error: null });
    mockCreateClient.mockResolvedValue(supabase);

    const response = await GET(getRequest(), params);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Receipt claim link not found' });
  });

  it('returns 410 for expired claims', async () => {
    const supabase = createSupabaseRpcMock({
      data: {
        ...baseClaim,
        expires_at: '2020-01-01T00:00:00.000Z',
      },
      error: null,
    });
    mockCreateClient.mockResolvedValue(supabase);

    const response = await GET(getRequest(), params);
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body).toEqual({ error: 'Receipt claim link has expired' });
  });

  it('returns 410 for the expired sentinel without claim details', async () => {
    const supabase = createSupabaseRpcMock({
      data: { expired: true },
      error: null,
    });
    mockCreateClient.mockResolvedValue(supabase);

    const response = await GET(getRequest(), params);
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body).toEqual({ error: 'Receipt claim link has expired' });
  });

  it('returns a generic 500 when loading the receipt claim fails', async () => {
    const supabase = createSupabaseRpcMock({
      data: null,
      error: { message: 'relation receipt_claims_secret does not exist' },
    });
    mockCreateClient.mockResolvedValue(supabase);

    const response = await GET(getRequest(), params);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to load receipt claim' });
    expect(JSON.stringify(body)).not.toContain('receipt_claims_secret');
    expect(mockConsoleError).toHaveBeenCalled();
  });

  it('returns a generic 500 when preview RPC data is malformed', async () => {
    const supabase = createSupabaseRpcMock({
      data: { id: 'claim-1' },
      error: null,
    });
    mockCreateClient.mockResolvedValue(supabase);

    const response = await GET(getRequest(), params);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to load receipt claim' });
    expect(mockConsoleError).toHaveBeenCalled();
  });
});
