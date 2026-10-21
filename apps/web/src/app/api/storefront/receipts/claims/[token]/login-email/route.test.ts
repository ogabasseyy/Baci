import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashReceiptClaimToken } from '@/lib/import-notifications/receipt-claim-links';

const mockCheckCsrfProtection = vi.fn();
const mockCreateClient = vi.fn();
const mockCreateAdminClient = vi.fn();
const mockConsoleError = vi
  .spyOn(console, 'error')
  .mockImplementation(() => undefined);

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrfProtection(...args),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockCreateClient(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}));

import { GET, POST } from './route';

const baseClaim = {
  claimed_at: null,
  claimed_by_user_id: null,
  customer_email: '  BasseyBJohn@Yahoo.CO.UK  ',
  customer_id: 'customer-1',
  customer_name: 'Bassey John',
  expires_at: '2099-01-01T00:00:00.000Z',
  id: 'claim-1',
  merchant_id: 'merchant-1',
  merchant: {
    business_name: 'Ogabassey',
    slug: 'ogabassey',
  },
  orders: [],
};

function createSupabaseRpcMock(
  response: { data: unknown; error: unknown },
  trackingResponse: { data: unknown; error: unknown } = {
    data: null,
    error: null,
  },
  hintResponse: { data: unknown; error: unknown } = {
    data: '  BasseyBJohn@Yahoo.CO.UK  ',
    error: null,
  }
) {
  return {
    rpc: vi.fn((name: string) => {
      if (name === 'preview_receipt_claim') {
        return Promise.resolve(response);
      }

      if (name === 'get_receipt_claim_login_hint') {
        return Promise.resolve(hintResponse);
      }

      if (name === 'record_receipt_claim_login_started_v2') {
        return Promise.resolve(trackingResponse);
      }

      return Promise.resolve({
        data: null,
        error: { message: `Unexpected RPC: ${name}` },
      });
    }),
  };
}

function getRequest(method = 'GET', search = '') {
  return new NextRequest(
    `http://localhost:3000/api/storefront/receipts/claims/claim-token/login-email${search}`,
    { method }
  );
}

const params = { params: Promise.resolve({ token: 'claim-token' }) };
const invalidParams = { params: Promise.resolve({ token: 'bad token' }) };

describe('GET /api/storefront/receipts/claims/[token]/login-email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConsoleError.mockClear();
    mockCheckCsrfProtection.mockResolvedValue({ response: null, valid: true });
  });

  it('returns 400 for invalid claim tokens', async () => {
    const response = await GET(getRequest(), invalidParams);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Invalid receipt claim link' });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid source query values', async () => {
    const response = await GET(getRequest('GET', '?source=mobile'), params);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: 'Invalid receipt claim login email query',
    });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('returns a sanitized email hint for a valid claim token', async () => {
    const supabase = createSupabaseRpcMock({ data: baseClaim, error: null });
    mockCreateClient.mockResolvedValue(supabase);
    mockCreateAdminClient.mockReturnValue(supabase);

    const response = await GET(getRequest(), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith('preview_receipt_claim', {
      p_token_hash: hashReceiptClaimToken('claim-token'),
    });
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'record_receipt_claim_login_started',
      expect.anything()
    );
    expect(body).toEqual({ emailHint: 'basseybjohn@yahoo.co.uk' });
  });

  it('serves the hint from the service function when the preview carries no email', async () => {
    const { customer_email: _dropped, ...trimmedClaim } = baseClaim;
    const supabase = createSupabaseRpcMock({
      data: trimmedClaim,
      error: null,
    });
    mockCreateClient.mockResolvedValue(supabase);
    mockCreateAdminClient.mockReturnValue(supabase);

    const response = await GET(getRequest(), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith('get_receipt_claim_login_hint', {
      p_token_hash: hashReceiptClaimToken('claim-token'),
    });
    expect(body).toEqual({ emailHint: 'basseybjohn@yahoo.co.uk' });
  });

  it('records app login-start activity from the mobile email hint request', async () => {
    const supabase = createSupabaseRpcMock({ data: baseClaim, error: null });
    mockCreateClient.mockResolvedValue(supabase);
    mockCreateAdminClient.mockReturnValue(supabase);

    const response = await GET(getRequest('GET', '?source=app'), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ emailHint: 'basseybjohn@yahoo.co.uk' });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'record_receipt_claim_login_started_v2',
      {
        p_source: 'app',
        p_token_hash: hashReceiptClaimToken('claim-token'),
      }
    );
  });

  it('does not block mobile email hints when app login-start tracking fails', async () => {
    const supabase = createSupabaseRpcMock(
      { data: baseClaim, error: null },
      { data: null, error: { message: 'tracking write failed' } }
    );
    mockCreateClient.mockResolvedValue(supabase);
    mockCreateAdminClient.mockReturnValue(supabase);

    const response = await GET(getRequest('GET', '?source=app'), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ emailHint: 'basseybjohn@yahoo.co.uk' });
    expect(mockConsoleError).toHaveBeenCalledWith(
      'Failed to record receipt claim login start',
      expect.any(Error)
    );
  });

  it('records login-start activity from POST', async () => {
    const supabase = createSupabaseRpcMock({ data: baseClaim, error: null });
    mockCreateClient.mockResolvedValue(supabase);

    const response = await POST(getRequest('POST'), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'record_receipt_claim_login_started_v2',
      {
        p_source: 'web',
        p_token_hash: hashReceiptClaimToken('claim-token'),
      }
    );
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'preview_receipt_claim',
      expect.anything()
    );
  });

  it('returns an error response when POST login tracking fails', async () => {
    const supabase = createSupabaseRpcMock(
      { data: baseClaim, error: null },
      { data: null, error: { message: 'tracking write failed' } }
    );
    mockCreateClient.mockResolvedValue(supabase);

    const response = await POST(getRequest('POST'), params);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: 'Failed to record receipt claim login start',
      code: 'login_start_tracking_failed',
    });
    expect(mockConsoleError).toHaveBeenCalled();
  });

  it('returns 400 for invalid POST claim tokens', async () => {
    const response = await POST(getRequest('POST'), invalidParams);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Invalid receipt claim link' });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('returns 403 when POST csrf validation fails', async () => {
    mockCheckCsrfProtection.mockResolvedValue({
      response: null,
      valid: false,
    });

    const response = await POST(getRequest('POST'), params);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Invalid CSRF token' });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('returns an empty email hint when claim data has an invalid email', async () => {
    const supabase = createSupabaseRpcMock(
      {
        data: { ...baseClaim, customer_email: 'not-an-email' },
        error: null,
      },
      { data: null, error: null },
      { data: 'not-an-email', error: null }
    );
    mockCreateClient.mockResolvedValue(supabase);
    mockCreateAdminClient.mockReturnValue(supabase);

    const response = await GET(getRequest(), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ emailHint: '' });
  });

  it('returns 404 when no claim matches the token', async () => {
    const supabase = createSupabaseRpcMock({ data: null, error: null });
    mockCreateClient.mockResolvedValue(supabase);

    const response = await GET(getRequest(), params);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Receipt claim link not found' });
  });

  it('returns a generic 500 when loading the email hint fails', async () => {
    const supabase = createSupabaseRpcMock({
      data: null,
      error: { message: 'relation receipt_claims_secret does not exist' },
    });
    mockCreateClient.mockResolvedValue(supabase);

    const response = await GET(getRequest(), params);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: 'Failed to load receipt claim login email',
    });
    expect(JSON.stringify(body)).not.toContain('receipt_claims_secret');
    expect(mockConsoleError).toHaveBeenCalled();
  });
});
