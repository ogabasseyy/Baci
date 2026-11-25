import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { guideBusinessOnboarding } from '@/ai/flows/guide-business-onboarding';
import { checkRateLimit } from '@/ai/provider';
import { getMobileBearerUser } from '../merchant-provisioning/get-mobile-bearer-user';
import { POST } from './route';

vi.mock('@/ai/flows/guide-business-onboarding', () => ({
  guideBusinessOnboarding: vi.fn(),
}));

vi.mock('@/ai/provider', () => ({
  checkRateLimit: vi.fn(),
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
const mockCheckRateLimit = vi.mocked(checkRateLimit);
const mockGuideBusinessOnboarding = vi.mocked(guideBusinessOnboarding);

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
    mockCheckRateLimit.mockReturnValue({
      allowed: true,
      remaining: 11,
      resetIn: 600_000,
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
    mockCheckRateLimit.mockReturnValueOnce({
      allowed: false,
      remaining: 0,
      resetIn: 300_000,
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
