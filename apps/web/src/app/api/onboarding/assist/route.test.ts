import { type NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runGuideBusinessOnboarding } from '@/ai/flows/guide-business-onboarding.core';
import { checkCsrfProtection } from '@/lib/csrf';
import { applyRateLimit, getTrustedClientIdentifier } from '@/lib/rate-limit';
import { POST } from './route';

const mockGetUser = vi.fn();

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({})),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: mockGetUser,
    },
  })),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn(async () => ({ valid: true })),
}));

vi.mock('@/ai/flows/guide-business-onboarding.core', () => ({
  runGuideBusinessOnboarding: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: vi.fn(),
  getTrustedClientIdentifier: vi.fn(() => '203.0.113.10'),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

function makeRequest(body: unknown, rawBody?: string): NextRequest {
  return new Request('https://usebaci.com/api/onboarding/assist', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: rawBody ?? JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe('POST /api/onboarding/assist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.mocked(checkCsrfProtection).mockResolvedValue({ valid: true });
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    });
    vi.mocked(applyRateLimit).mockResolvedValue({
      allowed: true,
      limit: 12,
      remaining: 11,
      resetTime: Date.now() + 600_000,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 403 when CSRF validation fails', async () => {
    vi.mocked(checkCsrfProtection).mockResolvedValueOnce({
      valid: false,
      response: NextResponse.json(
        { error: 'Invalid CSRF token' },
        { status: 403 }
      ),
    });

    const response = await POST(makeRequest({ task: 'generate_names' }));
    expect(response.status).toBe(403);
    expect(runGuideBusinessOnboarding).not.toHaveBeenCalled();
  });

  it('fails closed with 403 when CSRF validation returns valid: false without a response', async () => {
    vi.mocked(checkCsrfProtection).mockResolvedValueOnce({ valid: false });

    const response = await POST(makeRequest({ task: 'generate_names' }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'csrf_failed' });
    expect(applyRateLimit).not.toHaveBeenCalled();
    expect(runGuideBusinessOnboarding).not.toHaveBeenCalled();
  });

  it('returns 401 before checking CSRF when user is not authenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });

    const response = await POST(makeRequest({ task: 'generate_names' }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'unauthorized' });
    expect(checkCsrfProtection).not.toHaveBeenCalled();
  });

  it('rejects generate_names without description before consuming rate limits', async () => {
    const response = await POST(
      makeRequest({
        task: 'generate_names',
        businessName: '',
        businessType: 'fashion',
        brandPreferences: 'modern',
        description: '   ',
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'invalid_input' });
    expect(applyRateLimit).not.toHaveBeenCalled();
    expect(runGuideBusinessOnboarding).not.toHaveBeenCalled();
  });

  it('checks the IP rate limit before consuming the per-user bucket', async () => {
    vi.mocked(applyRateLimit).mockResolvedValueOnce({
      allowed: false,
      limit: 30,
      remaining: 0,
      resetTime: Date.now() + 300_000,
    });

    const response = await POST(
      makeRequest({
        task: 'generate_names',
        businessName: '',
        businessType: 'fashion',
        brandPreferences: 'modern',
        description: 'Sneakers in Lagos',
      })
    );

    expect(response.status).toBe(429);
    expect(applyRateLimit).toHaveBeenCalledTimes(1);
    expect(applyRateLimit).toHaveBeenCalledWith(
      'ip:203.0.113.10',
      '/api/onboarding/assist:ip',
      expect.objectContaining({ maxRequests: 30, failClosedWithoutRedis: true })
    );
  });

  it('skips the IP bucket when getTrustedClientIdentifier returns unknown and still enforces per-user limit', async () => {
    vi.mocked(getTrustedClientIdentifier).mockReturnValueOnce('unknown');
    vi.mocked(runGuideBusinessOnboarding).mockResolvedValueOnce({
      businessNames: ['Lagos Lace'],
    });

    const response = await POST(
      makeRequest({
        task: 'generate_names',
        businessName: '',
        businessType: 'fashion',
        brandPreferences: 'modern',
        description: 'Sneakers in Lagos',
      })
    );

    expect(response.status).toBe(200);
    expect(applyRateLimit).toHaveBeenCalledTimes(1);
    expect(applyRateLimit).toHaveBeenCalledWith(
      'user:user-123',
      '/api/onboarding/assist',
      expect.objectContaining({ maxRequests: 12, failClosedWithoutRedis: true })
    );
  });

  it('rejects extract_colors for another user or non-storage URL without consuming rate limits', async () => {
    const response = await POST(
      makeRequest({
        task: 'extract_colors',
        businessName: 'Kicks Hub',
        businessType: 'fashion',
        brandPreferences: 'modern',
        logoUrl:
          'https://project.supabase.co/storage/v1/object/public/images/onboarding/other-user/logo.png',
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'invalid_logo_url' });
    expect(applyRateLimit).not.toHaveBeenCalled();
    expect(runGuideBusinessOnboarding).not.toHaveBeenCalled();
  });

  it('allows extract_colors for the caller own onboarding logo URL and enables allowPaidOpenAi', async () => {
    vi.mocked(runGuideBusinessOnboarding).mockResolvedValueOnce({
      brandColors: {
        primary: '#1E293B',
        background: '#FFFFFF',
        accent: '#F59E0B',
      },
    });

    const response = await POST(
      makeRequest({
        task: 'extract_colors',
        businessName: 'Kicks Hub',
        businessType: 'fashion',
        brandPreferences: 'modern',
        logoUrl:
          'https://project.supabase.co/storage/v1/object/public/images/onboarding/user-123/logo.png',
      })
    );

    expect(response.status).toBe(200);
    expect(runGuideBusinessOnboarding).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'extract_colors' }),
      { allowPaidOpenAi: true }
    );
  });

  it('strips non-raster SVG fallback logos on generate_logos', async () => {
    vi.mocked(runGuideBusinessOnboarding).mockResolvedValueOnce({
      logos: ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
      brandColors: {
        primary: '#111111',
        background: '#FFFFFF',
        accent: '#F59E0B',
      },
    });

    const response = await POST(
      makeRequest({
        task: 'generate_logos',
        businessName: 'Kicks Hub',
        businessType: 'fashion',
        brandPreferences: 'minimal',
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      logos: [],
      brandColors: {
        primary: '#111111',
        background: '#FFFFFF',
        accent: '#F59E0B',
      },
    });
  });

  it('preserves valid raster logos on generate_logos', async () => {
    const pngLogo = 'data:image/png;base64,iVBORw0KGgo=';
    vi.mocked(runGuideBusinessOnboarding).mockResolvedValueOnce({
      logos: [pngLogo, 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
      brandColors: {
        primary: '#111111',
        background: '#FFFFFF',
        accent: '#F59E0B',
      },
    });

    const response = await POST(
      makeRequest({
        task: 'generate_logos',
        businessName: 'Kicks Hub',
        businessType: 'fashion',
        brandPreferences: 'minimal',
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      logos: [pngLogo],
      brandColors: {
        primary: '#111111',
        background: '#FFFFFF',
        accent: '#F59E0B',
      },
    });
  });

  it.each([
    {
      task: 'generate_names',
      extra: { description: 'Sneakers in Lagos' },
      ipEndpoint: '/api/onboarding/assist:ip',
      userEndpoint: '/api/onboarding/assist',
      userMax: 12,
    },
    {
      task: 'generate_logos',
      extra: {},
      ipEndpoint: '/api/onboarding/assist:logos:ip',
      userEndpoint: '/api/onboarding/assist:logos',
      userMax: 5,
    },
    {
      task: 'extract_colors',
      extra: {
        logoUrl:
          'https://project.supabase.co/storage/v1/object/public/images/onboarding/user-123/logo.png',
      },
      ipEndpoint: '/api/onboarding/assist:colors:ip',
      userEndpoint: '/api/onboarding/assist:colors',
      userMax: 10,
    },
  ])('enforces per-user 429 on $task after IP bucket allows', async ({
    task,
    extra,
    ipEndpoint,
    userEndpoint,
    userMax,
  }) => {
    vi.mocked(applyRateLimit)
      .mockResolvedValueOnce({
        allowed: true,
        limit: 30,
        remaining: 29,
        resetTime: Date.now() + 600_000,
      })
      .mockResolvedValueOnce({
        allowed: false,
        limit: userMax,
        remaining: 0,
        resetTime: Date.now() + 600_000,
      });

    const response = await POST(
      makeRequest({
        task,
        businessName: 'Kicks Hub',
        businessType: 'fashion',
        brandPreferences: 'modern',
        ...extra,
      })
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: 'rate_limited' });
    expect(applyRateLimit).toHaveBeenNthCalledWith(
      1,
      'ip:203.0.113.10',
      ipEndpoint,
      expect.objectContaining({ failClosedWithoutRedis: true })
    );
    expect(applyRateLimit).toHaveBeenNthCalledWith(
      2,
      'user:user-123',
      userEndpoint,
      expect.objectContaining({
        maxRequests: userMax,
        failClosedWithoutRedis: true,
      })
    );
    expect(runGuideBusinessOnboarding).not.toHaveBeenCalled();
  });

  it('maps AI rate-limit errors to 429 and unexpected AI errors to 503 ai_unavailable', async () => {
    vi.mocked(runGuideBusinessOnboarding).mockRejectedValueOnce(
      new Error('Too many AI onboarding requests for this account')
    );

    const rateLimited = await POST(
      makeRequest({
        task: 'generate_names',
        businessName: '',
        businessType: 'fashion',
        brandPreferences: 'modern',
        description: 'Sneakers in Lagos',
      })
    );
    expect(rateLimited.status).toBe(429);
    expect(await rateLimited.json()).toMatchObject({ code: 'rate_limited' });

    vi.mocked(runGuideBusinessOnboarding).mockRejectedValueOnce(
      new Error('Upstream Gemini timeout')
    );
    const unavailable = await POST(
      makeRequest({
        task: 'generate_names',
        businessName: '',
        businessType: 'fashion',
        brandPreferences: 'modern',
        description: 'Sneakers in Lagos',
      })
    );
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({ code: 'ai_unavailable' });
  });
});
