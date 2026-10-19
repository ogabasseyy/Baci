import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authGetUser: vi.fn(),
  checkCsrfProtection: vi.fn(),
  from: vi.fn(),
  getMerchantForApiRequest: vi.fn(),
  hasPermission: vi.fn(),
  loggerError: vi.fn(),
  payoutHistory: [] as Record<string, unknown>[],
  payoutHistoryError: null as { code: string; message: string } | null,
  selectedFields: '',
}));

vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/api-auth', () => ({
  hasPermission: (...args: unknown[]) => mocks.hasPermission(...args),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) =>
    mocks.checkCsrfProtection(...args),
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) =>
    mocks.getMerchantForApiRequest(...args),
  toUserAccess: vi.fn(() => ({ role: 'owner' })),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: mocks.loggerError } }));

function createPayoutHistoryQuery() {
  const query = {
    eq: vi.fn(() => query),
    order: vi.fn().mockImplementation(() =>
      Promise.resolve({
        data: mocks.payoutHistory,
        error: mocks.payoutHistoryError,
      })
    ),
  };
  return query;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mocks.authGetUser },
    from: mocks.from,
  })),
}));

const { GET, POST } = await import('./route');

function postRequest() {
  return new NextRequest('http://localhost/api/payouts/request', {
    body: JSON.stringify({ amount: 10_000 }),
    method: 'POST',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.payoutHistory = [];
  mocks.payoutHistoryError = null;
  mocks.selectedFields = '';
  mocks.from.mockImplementation(() => ({
    select: vi.fn((fields: string) => {
      mocks.selectedFields = fields;
      return createPayoutHistoryQuery();
    }),
  }));
  mocks.authGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  mocks.checkCsrfProtection.mockResolvedValue({ valid: true });
  mocks.getMerchantForApiRequest.mockResolvedValue({
    businessName: 'Scoped Merchant',
    merchantId: 'merchant-1',
    staffAccess: { isStaff: false, isOwner: true, permissions: {} },
  });
  mocks.hasPermission.mockReturnValue(true);
});

describe('POST /api/payouts/request', () => {
  it('authenticates before CSRF or merchant database work', async () => {
    mocks.authGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const response = await POST(postRequest());

    expect(response.status).toBe(401);
    expect(mocks.checkCsrfProtection).not.toHaveBeenCalled();
    expect(mocks.getMerchantForApiRequest).not.toHaveBeenCalled();
  });

  it('rejects invalid CSRF tokens after authentication', async () => {
    mocks.checkCsrfProtection.mockResolvedValue({
      valid: false,
      response: NextResponse.json({ error: 'Invalid CSRF' }, { status: 403 }),
    });

    const response = await POST(postRequest());

    expect(response.status).toBe(403);
    expect(mocks.getMerchantForApiRequest).not.toHaveBeenCalled();
  });

  it('keeps manual payout dispatch fail-closed for authorized merchants', async () => {
    const response = await POST(postRequest());
    const body = await response.json();

    expect(mocks.authGetUser).toHaveBeenCalledTimes(1);
    expect(mocks.checkCsrfProtection).toHaveBeenCalledTimes(1);
    expect(mocks.getMerchantForApiRequest).toHaveBeenCalledWith(
      expect.anything(),
      'user-1'
    );
    expect(mocks.hasPermission).toHaveBeenCalledWith(
      { role: 'owner' },
      'settings',
      'edit'
    );
    expect(response.status).toBe(503);
    expect(body).toEqual({
      code: 'payouts_unavailable',
      error: 'Manual payouts are temporarily unavailable',
    });
  });

  it('does not disclose payout availability to unauthorized staff', async () => {
    mocks.hasPermission.mockReturnValue(false);

    const response = await POST(postRequest());

    expect(response.status).toBe(403);
  });
});

describe('GET /api/payouts/request', () => {
  it('returns the unauthorized contract without querying payout history', async () => {
    mocks.authGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const response = await GET(
      new NextRequest('http://localhost/api/payouts/request')
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(mocks.getMerchantForApiRequest).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('returns the missing-merchant contract without querying payout history', async () => {
    mocks.getMerchantForApiRequest.mockResolvedValue(null);

    const response = await GET(
      new NextRequest('http://localhost/api/payouts/request')
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Merchant not found',
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('uses real columns and never exposes the full bank account number', async () => {
    mocks.payoutHistory = [
      {
        id: 'payout-1',
        amount: 10_000,
        currency: 'NGN',
        status: 'completed',
        bank_name: 'Access Bank',
        bank_account_name: 'Baci Merchant',
        bank_account_number: '0123456789',
        korapay_reference: 'PAYOUT-1',
        requested_at: '2026-08-05T10:00:00.000Z',
        processed_at: '2026-08-05T10:01:00.000Z',
        completed_at: '2026-08-05T10:01:00.000Z',
        created_at: '2026-08-05T10:00:00.000Z',
      },
    ];

    const response = await GET(
      new NextRequest('http://localhost/api/payouts/request')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.selectedFields).toContain('bank_account_number');
    expect(mocks.selectedFields).toContain('korapay_reference');
    expect(body.payouts[0]).toMatchObject({
      bankAccountNumber: '••••6789',
      reference: 'PAYOUT-1',
    });
    expect(JSON.stringify(body)).not.toContain('0123456789');
    expect(JSON.stringify(body)).not.toContain('merchant_id');
  });

  it('fails closed when payout history cannot be read', async () => {
    mocks.payoutHistoryError = {
      code: '42501',
      message: 'read failed',
    };

    const response = await GET(
      new NextRequest('http://localhost/api/payouts/request')
    );

    expect(response.status).toBe(500);
    expect(mocks.loggerError).toHaveBeenCalledWith({
      message: 'Failed to fetch payouts',
      merchantId: 'merchant-1',
      errorCode: '42501',
      errorMessage: 'read failed',
    });
  });

  it('rejects staff payout history instead of returning an owner-RLS empty ledger', async () => {
    mocks.getMerchantForApiRequest.mockResolvedValue({
      merchantId: 'merchant-1',
      staffAccess: { isStaff: true, isOwner: false, permissions: {} },
    });

    const response = await GET(
      new NextRequest('http://localhost/api/payouts/request')
    );

    expect(response.status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
