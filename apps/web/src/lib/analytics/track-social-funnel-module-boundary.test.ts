import { expect, it, vi } from 'vitest';

it('loads funnel tracking without loading provider UI wrappers', async () => {
  vi.resetModules();
  vi.doMock('@/components/analytics/tiktok-pixel', () => {
    throw new Error('TikTok wrapper loaded by funnel tracking');
  });
  vi.doMock('@/components/analytics/snapchat-pixel', () => {
    throw new Error('Snapchat wrapper loaded by funnel tracking');
  });
  try {
    const module = await import('./track-social-funnel');
    expect(module.trackSocialFunnel).toBeTypeOf('function');
  } finally {
    vi.doUnmock('@/components/analytics/tiktok-pixel');
    vi.doUnmock('@/components/analytics/snapchat-pixel');
    vi.resetModules();
  }
});
