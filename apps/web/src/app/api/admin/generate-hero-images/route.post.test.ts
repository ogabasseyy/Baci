import { beforeEach, describe, expect, it } from 'vitest';
import {
  getHeroImageRouteMocks,
  heroImageRequest,
  resetHeroImageRouteMocks,
} from './route.test-helpers';

const heroImageRouteMocks = getHeroImageRouteMocks();
const { POST } = await import('./route');

describe('POST /api/admin/generate-hero-images', () => {
  beforeEach(resetHeroImageRouteMocks);

  it('returns 401 when unauthenticated', async () => {
    const response = await POST(
      heroImageRequest(JSON.stringify({ category: 'electronics' }))
    );

    expect(response.status).toBe(401);
  });

  it('denies a lower-privilege platform admin without content access', async () => {
    heroImageRouteMocks.getPlatformAdminAuthForPermission.mockResolvedValueOnce(
      { status: 'forbidden' }
    );

    const response = await POST(
      heroImageRequest(JSON.stringify({ category: 'electronics' }))
    );

    expect(response.status).toBe(403);
    expect(
      heroImageRouteMocks.getPlatformAdminAuthForPermission
    ).toHaveBeenCalledWith('content.manage');
  });

  it('rejects invalid request payloads before generation', async () => {
    heroImageRouteMocks.getPlatformAdminAuthForPermission.mockResolvedValueOnce(
      { status: 'authenticated' }
    );

    const response = await POST(
      heroImageRequest(JSON.stringify({ category: 'phones', count: 50 }))
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid request payload');
    expect(heroImageRouteMocks.generateHeroImageBatch).not.toHaveBeenCalled();
  });

  it('rejects non-object JSON payloads without throwing', async () => {
    heroImageRouteMocks.getPlatformAdminAuthForPermission.mockResolvedValueOnce(
      { status: 'authenticated' }
    );

    const response = await POST(heroImageRequest('null'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid request payload');
    expect(heroImageRouteMocks.generateHeroImageBatch).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON payloads without throwing', async () => {
    heroImageRouteMocks.getPlatformAdminAuthForPermission.mockResolvedValueOnce(
      { status: 'authenticated' }
    );

    const response = await POST(heroImageRequest('{"category":'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid request payload');
    expect(heroImageRouteMocks.generateHeroImageBatch).not.toHaveBeenCalled();
    expect(heroImageRouteMocks.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Invalid hero image generation JSON payload',
      })
    );
  });

  it('generates hero images for platform admins', async () => {
    heroImageRouteMocks.getPlatformAdminAuthForPermission.mockResolvedValueOnce(
      {
        status: 'authenticated',
        user: { email: 'admin@test.com', id: 'admin-1' },
      }
    );

    const response = await POST(
      heroImageRequest(JSON.stringify({ category: 'electronics', count: 2 }))
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(heroImageRouteMocks.generateHeroImageBatch).toHaveBeenCalledWith(
      'electronics',
      2
    );
    expect(body).toEqual({
      success: true,
      imageIds: ['hero-1', 'hero-2'],
      count: 2,
      message: 'Successfully generated 2 hero images for electronics',
    });
  });

  it('keeps AI provider errors out of the public response', async () => {
    heroImageRouteMocks.getPlatformAdminAuthForPermission.mockResolvedValueOnce(
      {
        status: 'authenticated',
        user: { email: 'admin@test.com', id: 'admin-1' },
      }
    );
    heroImageRouteMocks.generateHeroImageBatch.mockResolvedValueOnce({
      error: 'Imagen quota for provider-account-123',
      success: false,
    });

    const response = await POST(
      heroImageRequest(JSON.stringify({ category: 'electronics', count: 2 }))
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      code: 'hero_image_generation_failed',
      error: 'Unable to generate hero images.',
    });
    expect(JSON.stringify(body)).not.toContain('provider-account-123');
    expect(heroImageRouteMocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Imagen quota for provider-account-123',
        message: 'Hero image generation failed',
      })
    );
  });

  it('returns 429 and skips generation when rate limited', async () => {
    heroImageRouteMocks.getPlatformAdminAuthForPermission.mockResolvedValueOnce(
      {
        status: 'authenticated',
        user: { email: 'admin@test.com', id: 'admin-1' },
      }
    );
    heroImageRouteMocks.checkRateLimit.mockResolvedValueOnce(false);

    const response = await POST(
      heroImageRequest(JSON.stringify({ category: 'electronics', count: 2 }))
    );
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body).toEqual({
      error: 'Rate limit exceeded',
      code: 'rate_limited',
    });
    expect(heroImageRouteMocks.generateHeroImageBatch).not.toHaveBeenCalled();
  });
});
