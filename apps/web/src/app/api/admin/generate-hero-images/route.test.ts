import { beforeEach, describe, expect, it } from 'vitest';
import {
  getHeroImageRouteMocks,
  resetHeroImageRouteMocks,
} from './route.test-helpers';

const heroImageRouteMocks = getHeroImageRouteMocks();
const { GET } = await import('./route');

describe('GET /api/admin/generate-hero-images', () => {
  beforeEach(resetHeroImageRouteMocks);

  it('returns 401 when unauthenticated', async () => {
    const response = await GET();

    expect(response.status).toBe(401);
  });

  it('denies a lower-privilege platform admin without content access', async () => {
    heroImageRouteMocks.getPlatformAdminAuthForPermission.mockResolvedValueOnce(
      { status: 'forbidden' }
    );

    const response = await GET();

    expect(response.status).toBe(403);
    expect(
      heroImageRouteMocks.getPlatformAdminAuthForPermission
    ).toHaveBeenCalledWith('content.manage');
  });

  it('returns hero image statistics for platform admins', async () => {
    heroImageRouteMocks.getPlatformAdminAuthForPermission.mockResolvedValueOnce(
      { status: 'authenticated' }
    );
    heroImageRouteMocks.eq.mockResolvedValueOnce({
      data: [
        { category: 'electronics', usage_count: 2 },
        { category: 'electronics', usage_count: 6 },
        { category: 'fashion', usage_count: 1 },
      ],
      error: null,
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      statistics: {
        electronics: { total: 2, avgUsage: 4, totalUsage: 8 },
        fashion: { total: 1, avgUsage: 1, totalUsage: 1 },
      },
      totalImages: 3,
    });
  });

  it('logs stats failures without exposing raw database errors', async () => {
    heroImageRouteMocks.getPlatformAdminAuthForPermission.mockResolvedValueOnce(
      { status: 'authenticated' }
    );
    heroImageRouteMocks.eq.mockResolvedValueOnce({
      data: null,
      error: { message: 'relation ai_hero_images does not exist' },
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to retrieve hero image statistics' });
    expect(body.error).not.toContain('relation');
    expect(heroImageRouteMocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: { message: 'relation ai_hero_images does not exist' },
        message: 'Hero image stats query failed',
      })
    );
  });
});
