import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const mockMerchantMaybeSingle = vi.fn();

function makeSupabaseMock() {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: mockMerchantMaybeSingle,
          })),
        })),
      })),
    })),
  };
}

describe('POST /api/mobile/onboarding-assist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    mockMerchantMaybeSingle.mockResolvedValue({
      data: { id: 'm-1' },
      error: null,
    });
    mockGetMobileBearerUser.mockResolvedValue({
      authenticated: true,
      user: { id: 'user-123' } as never,
      supabase: makeSupabaseMock() as never,
    });
    mockApplyRateLimit.mockResolvedValue({
      allowed: true,
      limit: 12,
      remaining: 11,
      resetTime: Date.now() + 600_000,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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

  it('applies the stricter image rate-limit buckets to extract_colors for uploaded media URLs', async () => {
    mockGuideBusinessOnboarding.mockResolvedValueOnce({
      brandColors: {
        primary: '#111111',
        background: '#FFFFFF',
        accent: '#F59E0B',
      },
    });

    const response = await POST(
      makeRequest({
        task: 'extract_colors',
        businessName: 'Kicks Hub',
        businessType: 'fashion',
        brandPreferences: 'black and gold',
        logoUrl:
          'https://project.supabase.co/storage/v1/object/public/media/m-1/logo.png',
      })
    );

    expect(response.status).toBe(200);
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
  });

  it('rejects extract_colors when logoUrl is outside the project media storage bucket', async () => {
    const response = await POST(
      makeRequest({
        task: 'extract_colors',
        businessName: 'Kicks Hub',
        businessType: 'fashion',
        brandPreferences: 'black and gold',
        logoUrl: 'https://arbitrary.example.com/logo.png',
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'invalid_logo_url' });
    expect(mockGuideBusinessOnboarding).not.toHaveBeenCalled();
  });

  it('returns 403 when extract_colors targets another merchant media folder', async () => {
    mockMerchantMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const response = await POST(
      makeRequest({
        task: 'extract_colors',
        businessName: 'Kicks Hub',
        businessType: 'fashion',
        brandPreferences: 'black and gold',
        logoUrl:
          'https://project.supabase.co/storage/v1/object/public/media/other-merchant/logo.png',
      })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'forbidden_logo_url' });
    expect(mockGuideBusinessOnboarding).not.toHaveBeenCalled();
  });

  it('rate-limits extract_colors before running the merchant ownership DB query', async () => {
    mockApplyRateLimit.mockResolvedValueOnce({
      allowed: false,
      limit: 5,
      remaining: 0,
      resetTime: Date.now() + 300_000,
    });

    const response = await POST(
      makeRequest({
        task: 'extract_colors',
        businessName: 'Kicks Hub',
        businessType: 'fashion',
        brandPreferences: 'black and gold',
        logoUrl:
          'https://project.supabase.co/storage/v1/object/public/media/other-merchant/logo.png',
      })
    );

    expect(response.status).toBe(429);
    expect(mockMerchantMaybeSingle).not.toHaveBeenCalled();
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

  it('strips non-raster SVG fallback logos for mobile clients while preserving brandColors', async () => {
    mockGuideBusinessOnboarding.mockResolvedValueOnce({
      logos: ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
      brandColors: {
        primary: '#1E293B',
        background: '#FFFFFF',
        accent: '#F59E0B',
      },
    });

    const response = await POST(
      makeRequest({
        task: 'generate_logos',
        businessName: 'Kicks Hub',
        businessType: 'fashion',
        brandPreferences: 'black and gold',
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      logos: [],
      brandColors: {
        primary: '#1E293B',
        background: '#FFFFFF',
        accent: '#F59E0B',
      },
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
