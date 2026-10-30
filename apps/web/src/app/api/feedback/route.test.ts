import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockAuth,
  mockCheckCsrf,
  mockGetMerchant,
  mockCheckRateLimit,
  mockSendEmail,
  mockInsert,
  mockSingle,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCheckCsrf: vi.fn(),
  mockGetMerchant: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockSendEmail: vi.fn(),
  mockInsert: vi.fn(),
  mockSingle: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mockAuth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mockCheckCsrf }));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: mockGetMerchant,
}));
vi.mock('@/lib/rate-limiter', () => ({ checkRateLimit: mockCheckRateLimit }));
vi.mock('@/lib/feedback/send-feedback-report-email', () => ({
  sendFeedbackReportEmail: mockSendEmail,
}));

import { POST } from './route';

const supabase = {
  from: vi.fn(() => ({
    insert: (row: unknown) => {
      mockInsert(row);
      return { select: () => ({ single: mockSingle }) };
    },
  })),
};

function req(body: unknown, malformed = false): NextRequest {
  return {
    method: 'POST',
    headers: new Headers(),
    json: () =>
      malformed
        ? Promise.reject(new SyntaxError('Unexpected token'))
        : Promise.resolve(body),
  } as unknown as NextRequest;
}

const validBody = {
  message: 'The orders list is empty',
  screen: '/orders',
  platform: 'ios',
  appVersion: '2.1.530',
  device: 'iPhone 15',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  mockAuth.mockResolvedValue({
    user: { id: 'user-1', email: 'owner@example.com' },
    error: null,
    supabase,
  });
  mockCheckCsrf.mockResolvedValue({ valid: true });
  mockGetMerchant.mockResolvedValue({
    merchantId: 'merchant-1',
    merchantSlug: 'ogabassey',
    businessName: 'Ogabassey',
    staffAccess: { isOwner: true },
  });
  mockCheckRateLimit.mockResolvedValue(true);
  mockSingle.mockResolvedValue({ data: { id: 'fb-1' }, error: null });
  mockSendEmail.mockResolvedValue(true);
});

describe('POST /api/feedback', () => {
  it('returns 401 when the caller is not signed in', async () => {
    mockAuth.mockResolvedValue({ user: null, error: null, supabase: null });

    const res = await POST(req(validBody));

    expect(res.status).toBe(401);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('returns 403 without saving when CSRF validation fails', async () => {
    mockCheckCsrf.mockResolvedValue({ valid: false });

    const res = await POST(req(validBody));

    expect(res.status).toBe(403);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await POST(req(null, true));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'invalid_feedback' });
  });

  it('returns 400 for an empty message', async () => {
    const res = await POST(req({ message: '   ' }));

    expect(res.status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('returns 403 when the user has no merchant', async () => {
    mockGetMerchant.mockResolvedValue(null);

    const res = await POST(req(validBody));

    expect(res.status).toBe(403);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('returns 429 when the sender is over the rate limit', async () => {
    mockCheckRateLimit.mockResolvedValue(false);

    const res = await POST(req(validBody));

    expect(res.status).toBe(429);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('fails closed with 503 when the rate limit check is unavailable', async () => {
    mockCheckRateLimit.mockRejectedValue(new Error('rpc down'));

    const res = await POST(req(validBody));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: 'Feedback is temporarily unavailable. Try again shortly.',
      code: 'rate_limit_unavailable',
    });
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      'feedback-report',
      5,
      10,
      { failClosed: true }
    );
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('saves the report under the resolved merchant and emails support', async () => {
    const res = await POST(req(validBody));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'fb-1', emailed: true });
    expect(mockInsert).toHaveBeenCalledWith({
      merchant_id: 'merchant-1',
      user_id: 'user-1',
      message: 'The orders list is empty',
      screen: '/orders',
      platform: 'ios',
      app_version: '2.1.530',
      device: 'iPhone 15',
    });
    expect(mockSendEmail).toHaveBeenCalledWith({
      report: validBody,
      feedbackId: 'fb-1',
      businessName: 'Ogabassey',
      merchantSlug: 'ogabassey',
      senderEmail: 'owner@example.com',
      submittedAt: expect.any(Date),
    });
  });

  it('returns 500 without emailing when the report cannot be saved', async () => {
    mockSingle.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    });

    const res = await POST(req(validBody));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: 'Could not save feedback',
      code: 'feedback_save_failed',
    });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('still succeeds when the email could not be sent', async () => {
    mockSendEmail.mockResolvedValue(false);

    const res = await POST(req(validBody));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'fb-1', emailed: false });
  });
});
