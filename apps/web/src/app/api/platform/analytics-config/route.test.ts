import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  abortSignal: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ rpc: mocks.rpc })),
}));

const { GET } = await import('./route');

const config = {
  facebook_pixel_id: '123',
  google_analytics_id: 'G-ABC',
  snapchat_pixel_id: null,
  tiktok_pixel_id: null,
  twitter_pixel_id: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.abortSignal.mockResolvedValue({ data: [config], error: null });
  mocks.rpc.mockReturnValue({ abortSignal: mocks.abortSignal });
});

describe('GET /api/platform/analytics-config', () => {
  it('returns the bounded public analytics projection', async () => {
    const result = await GET();

    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toEqual(config);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'get_public_platform_analytics_config_v1'
    );
    expect(result.headers.get('Cache-Control')).toContain('s-maxage=300');
  });

  it('returns an empty safe projection when the RPC fails', async () => {
    mocks.abortSignal.mockResolvedValue({
      data: null,
      error: { message: 'unavailable' },
    });

    const result = await GET();

    await expect(result.json()).resolves.toEqual({
      facebook_pixel_id: null,
      google_analytics_id: null,
      snapchat_pixel_id: null,
      tiktok_pixel_id: null,
      twitter_pixel_id: null,
    });
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('does not return malformed or extra RPC fields', async () => {
    mocks.abortSignal.mockResolvedValue({
      data: [{ ...config, google_analytics_id: '' }],
      error: null,
    });

    const result = await GET();
    const body = await result.json();

    expect(body.google_analytics_id).toBeNull();
    expect(body.ga4_api_secret).toBeUndefined();
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
