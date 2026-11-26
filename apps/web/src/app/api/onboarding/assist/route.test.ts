import { type NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runGuideBusinessOnboarding } from '@/ai/flows/guide-business-onboarding.core';
import { checkCsrfProtection } from '@/lib/csrf';
import { applyRateLimit } from '@/lib/rate-limit';
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

  it('returns 401 when user is not authenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });

    const response = await POST(makeRequest({ task: 'generate_names' }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'unauthorized' });
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

  it('rejects extract_colors for another user or non-storage URL', async () => {
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
});
