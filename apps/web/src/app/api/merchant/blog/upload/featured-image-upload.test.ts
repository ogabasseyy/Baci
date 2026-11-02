import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BLOG_MEDIA_CDN_BASE,
  createSupabaseMock,
  MockBlogFeaturedImageError,
  mockGenerateFeaturedImageVariants,
  ownerAccess,
} from './route.test-support';

const { uploadFeaturedBlogImage } = await import('./featured-image-upload');

const fileToken = 'featured-upload-token';
const filename = `${fileToken}.png`;
const filePath = `${ownerAccess.merchantId}/blog/${filename}`;
const file = new File(['image-bytes'], 'cover.png', { type: 'image/png' });
const sourceBuffer = Buffer.from('image-bytes');

describe('uploadFeaturedBlogImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateFeaturedImageVariants.mockResolvedValue({
      source: { width: 1200, height: 675, totalPixels: 810000 },
      variants: {
        landscape_16x9: {
          key: 'landscape_16x9',
          width: 1200,
          height: 675,
          contentType: 'image/webp',
          buffer: Buffer.from('landscape'),
        },
      },
    });
  });

  function upload(input: {
    supabase: ReturnType<typeof createSupabaseMock>['supabase'];
    uploadedPaths?: string[];
  }) {
    return uploadFeaturedBlogImage({
      ...input,
      file,
      filePath,
      fileToken,
      filename,
      merchantId: ownerAccess.merchantId,
      sourceBuffer,
      uploadedPaths: input.uploadedPaths ?? [],
    });
  }

  it('uploads the original and variants to media with the existing response contract', async () => {
    const { supabase, upload: storageUpload } = createSupabaseMock();
    const infoSpy = vi
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    try {
      const response = await upload({ supabase });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(supabase.storage.from).toHaveBeenCalledWith('media');
      expect(storageUpload).toHaveBeenCalledTimes(2);
      expect(body).toMatchObject({
        path: filePath,
        width: 1200,
        height: 675,
        variants: {
          landscape_16x9: `${BLOG_MEDIA_CDN_BASE}/${ownerAccess.merchantId}/blog/${fileToken}/landscape_16x9.webp`,
        },
      });
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('admits cleanup before removing a partially uploaded original', async () => {
    const { supabase, upload: storageUpload, remove } = createSupabaseMock();
    storageUpload
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: new Error('variant failed') });
    const response = await upload({ supabase });
    expect(response.status).toBe(500);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'claim_merchant_media_deletion_batch',
      {
        p_merchant_id: ownerAccess.merchantId,
        p_identities: [filePath],
      }
    );
    expect(remove).toHaveBeenCalledWith([filePath]);
    expect(supabase.rpc.mock.invocationCallOrder[0]).toBeLessThan(
      remove.mock.invocationCallOrder[0]
    );
    expect(supabase.rpc).toHaveBeenCalledWith(
      'complete_merchant_media_deletion',
      {
        p_merchant_id: ownerAccess.merchantId,
        p_path: filePath,
      }
    );
  });

  it('does not remove uploaded media if admission fails', async () => {
    const { supabase, upload: storageUpload, remove } = createSupabaseMock();
    storageUpload
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: new Error('variant failed') });
    supabase.rpc.mockRejectedValueOnce(new Error('admission unavailable'));
    const response = await upload({ supabase });
    expect(response.status).toBe(500);
    expect(remove).not.toHaveBeenCalled();
  });

  it('preserves featured validation errors without writing media', async () => {
    const { supabase, upload: storageUpload } = createSupabaseMock();
    mockGenerateFeaturedImageVariants.mockRejectedValue(
      new MockBlogFeaturedImageError(
        'FEATURED_IMAGE_DIMENSIONS_TOO_SMALL',
        'Featured image must be at least 1200x675.'
      )
    );

    const response = await upload({ supabase });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('FEATURED_IMAGE_DIMENSIONS_TOO_SMALL');
    expect(storageUpload).not.toHaveBeenCalled();
  });
});
