import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: vi.fn(),
}));

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: vi.fn(),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn(),
}));

vi.mock('@/lib/rate-limiter', () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock('@/lib/monnify', () => ({
  getMonnifyToken: vi.fn(),
}));

import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { getMerchantForApiRequest } from '@/lib/get-merchant-for-api-request';
import { getMonnifyToken } from '@/lib/monnify';
import { checkRateLimit } from '@/lib/rate-limiter';
import { POST } from './route';
import {
  makeNinResponse,
  makeRequest,
  makeSupabaseMock,
  validNinBody,
} from './route.test-helpers';

describe('POST /api/merchant/verify-nin provider verification', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkCsrfProtection).mockResolvedValue({ valid: true });
    vi.mocked(checkRateLimit).mockResolvedValue(true);
    vi.mocked(getMonnifyToken).mockResolvedValue('mock-token');
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: { id: 'user-1' },
      error: null,
      supabase: makeSupabaseMock(),
    } as unknown as Awaited<ReturnType<typeof authenticateApiRequest>>);
    vi.mocked(getMerchantForApiRequest).mockResolvedValue({
      merchantId: validNinBody.merchantId,
      staffAccess: {
        isOwner: true,
        isStaff: false,
        permissions: { full_access: { all: true } },
        role: null,
      },
    });
  });

  it('returns 200 with verified: true when names match', async () => {
    const supabaseMock = makeSupabaseMock();
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: { id: 'user-1' },
      error: null,
      supabase: supabaseMock,
    } as unknown as Awaited<ReturnType<typeof authenticateApiRequest>>);
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => makeNinResponse('John', 'Doe'),
    } as Response);

    const res = await POST(makeRequest(validNinBody));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ verified: true });
    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      'record_nin_verification',
      expect.objectContaining({
        p_merchant_id: validNinBody.merchantId,
        p_nin: '12345678901',
      })
    );
  });

  it('matches Sharon Okoh when Monnify returns an additional name component', async () => {
    const supabaseMock = makeSupabaseMock();
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: { id: 'user-1' },
      error: null,
      supabase: supabaseMock,
    } as unknown as Awaited<ReturnType<typeof authenticateApiRequest>>);
    const ninResponse = makeNinResponse('Sharon', 'Godwin');
    ninResponse.responseBody.middleName = 'Okoh';
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ninResponse,
    } as Response);

    const res = await POST(
      makeRequest({
        ...validNinBody,
        firstName: 'Sharon',
        lastName: 'Okoh',
      })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ verified: true });
    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      'record_nin_verification',
      expect.objectContaining({
        p_first_name: 'Sharon',
        p_last_name: 'Okoh',
      })
    );
  });

  it('records a verified NIN for the exact merchant selected by a multi-merchant owner', async () => {
    const supabaseMock = makeSupabaseMock();
    const selectedMerchantId = '22222222-2222-4222-8222-222222222222';
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: { id: 'user-1' },
      error: null,
      supabase: supabaseMock,
    } as unknown as Awaited<ReturnType<typeof authenticateApiRequest>>);
    vi.mocked(getMerchantForApiRequest).mockResolvedValue({
      merchantId: selectedMerchantId,
      staffAccess: {
        isOwner: true,
        isStaff: false,
        permissions: { full_access: { all: true } },
        role: null,
      },
    });
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => makeNinResponse('John', 'Doe'),
    } as Response);

    const res = await POST(
      makeRequest({ ...validNinBody, merchantId: selectedMerchantId })
    );

    expect(res.status).toBe(200);
    expect(getMerchantForApiRequest).toHaveBeenCalledWith(
      supabaseMock,
      'user-1',
      { requestedMerchantId: selectedMerchantId }
    );
    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      'record_nin_verification',
      expect.objectContaining({ p_merchant_id: selectedMerchantId })
    );
  });

  it('returns 200 with verified: false when names do not match', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => makeNinResponse('Jane', 'Smith'),
    } as Response);

    const res = await POST(makeRequest(validNinBody));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ verified: false });
  });

  it('returns 500 when Monnify API fails', async () => {
    vi.mocked(getMonnifyToken).mockRejectedValueOnce(new Error('Auth failed'));

    const res = await POST(makeRequest(validNinBody));

    expect(res.status).toBe(500);
  });
});
