import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runGuideBusinessOnboarding } from '@/ai/flows/guide-business-onboarding.core';
import { applyRateLimit } from '@/lib/rate-limit';
import { getMobileBearerUser } from '../merchant-provisioning/get-mobile-bearer-user';
import { POST } from './route';

vi.mock('@/ai/flows/guide-business-onboarding.core', () => ({
  runGuideBusinessOnboarding: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: vi.fn(),
  getTrustedClientIdentifier: vi.fn(() => '203.0.113.10'),
}));

vi.mock('../merchant-provisioning/get-mobile-bearer-user', () => ({
  getMobileBearerUser: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

const mockGetMobileBearerUser = vi.mocked(getMobileBearerUser);
const mockApplyRateLimit = vi.mocked(applyRateLimit);
const mockGuideBusinessOnboarding = vi.mocked(runGuideBusinessOnboarding);

function makeRequest(body: unknown, rawBody?: string): NextRequest {
  return new Request('https://usebaci.com/api/mobile/onboarding-assist', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer test-token',
    },
    body: rawBody ?? JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe('POST /api/mobile/onboarding-assist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMobileBearerUser.mockResolvedValue({
      authenticated: true,
      user: { id: 'user-123' } as never,
      supabase: {} as never,
    });
    mockApplyRateLimit.mockResolvedValue({
      allowed: true,
      limit: 12,
      remaining: 11,
      resetTime: Date.now() + 600_000,
    });
  });

  it('returns 401 when bearer authentication fails', async () => {
    mockGetMobileBearerUser.mockResolvedValueOnce({ authenticated: false });

    const response = await POST(
      makeRequest({
        task: 'generate_names',
        businessName: '',
        businessType: 'fashion',
        brandPreferences: 'modern',
        description: 'streetwear sneakers in Lagos',
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: 'Authentication required.',
      code: 'unauthorized',
    });
    expect(mockGuideBusinessOnboarding).not.toHaveBeenCalled();
  });

  it('returns 429 when the user exceeds the rate limit', async () => {
    mockApplyRateLimit.mockResolvedValueOnce({
      allowed: false,
      limit: 12,
      remaining: 0,
      resetTime: Date.now() + 300_000,
    });

    const response = await POST(
      makeRequest({
        task: 'generate_names',
        businessName: '',
        businessType: 'fashion',
        brandPreferences: 'modern',
        description: 'streetwear sneakers in Lagos',
      })
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: 'rate_limited' });
    expect(mockGuideBusinessOnboarding).not.toHaveBeenCalled();
  });

  it('returns 429 when the secondary IP rate limit is exceeded', async () => {
    mockApplyRateLimit
      .mockResolvedValueOnce({
        allowed: true,
        limit: 6,
        remaining: 5,
        resetTime: Date.now() + 300_000,
      })
      .mockResolvedValueOnce({
        allowed: false,
        limit: 15,
        remaining: 0,
        resetTime: Date.now() + 300_000,
      });

    const response = await POST(
      makeRequest({
        task: 'generate_logos',
        businessName: 'Kicks Hub',
        businessType: 'fashion',
        brandPreferences: 'black and gold',
      })
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: 'rate_limited' });
    expect(mockApplyRateLimit).toHaveBeenNthCalledWith(
      1,
      'user:user-123',
      '/api/mobile/onboarding-assist:logos',
      expect.objectContaining({
        maxRequests: 5,
        failClosedWithoutRedis: true,
      })
    );
    expect(mockApplyRateLimit).toHaveBeenNthCalledWith(
      2,
      'ip:203.0.113.10',
      '/api/mobile/onboarding-assist:logos:ip',
      expect.objectContaining({
        maxRequests: 15,
        failClosedWithoutRedis: true,
      })
    );
    expect(mockGuideBusinessOnboarding).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON', async () => {
    const response = await POST(makeRequest(null, '{invalid-json'));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Invalid JSON body.',
      code: 'invalid_json',
    });
  });

  it('returns 400 when input fails schema validation', async () => {
    const response = await POST(
      makeRequest({
        task: 'unknown_task',
        businessName: 'Baci',
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'invalid_input' });
  });

  it('returns generated business names on success', async () => {
    mockGuideBusinessOnboarding.mockResolvedValueOnce({
      businessNames: ['Lagos Lace', 'Kicks Hub', 'Sole Craft'],
    });

    const response = await POST(
      makeRequest({
        task: 'generate_names',
        businessName: '',
        businessType: 'fashion',
        brandPreferences: 'modern',
        description: 'streetwear sneakers in Lagos',
        tone: 'Modern',
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      businessNames: ['Lagos Lace', 'Kicks Hub', 'Sole Craft'],
    });
  });

  it('returns 503 with a safe message when AI generation throws', async () => {
    mockGuideBusinessOnboarding.mockRejectedValueOnce(
      new Error('upstream provider error with internal details')
    );

    const response = await POST(
      makeRequest({
        task: 'generate_logos',
        businessName: 'Kicks Hub',
        businessType: 'fashion',
        brandPreferences: 'black and gold',
      })
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Unable to complete AI onboarding request right now.',
      code: 'ai_unavailable',
    });
  });
});
