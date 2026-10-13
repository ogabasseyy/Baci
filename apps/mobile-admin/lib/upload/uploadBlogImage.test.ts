import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadBlogImage } from './uploadBlogImage';

const mocks = vi.hoisted(() => ({
  getPublicUrl: vi.fn(),
  readUploadBytes: vi.fn(),
  storageUpload: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        getPublicUrl: mocks.getPublicUrl,
        upload: mocks.storageUpload,
      }),
    },
  },
}));

vi.mock('./readUploadBytes', () => ({
  readUploadBytes: mocks.readUploadBytes,
}));

describe('uploadBlogImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(123);
    mocks.readUploadBytes.mockResolvedValue(new ArrayBuffer(2));
    mocks.storageUpload.mockResolvedValue({ error: null });
    mocks.getPublicUrl.mockReturnValue({
      data: { publicUrl: 'https://example.com/blog/hero.png' },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uploads bytes under the merchant blog namespace and returns its public URL', async () => {
    const bytes = new ArrayBuffer(2);
    mocks.readUploadBytes.mockResolvedValueOnce(bytes);

    await expect(
      uploadBlogImage('file:///hero.png', 'merchant-1')
    ).resolves.toBe('https://example.com/blog/hero.png');

    expect(mocks.storageUpload).toHaveBeenCalledWith(
      'merchant-1/blog/123.png',
      bytes,
      { contentType: 'image/png', upsert: true }
    );
    expect(mocks.getPublicUrl).toHaveBeenCalledWith('merchant-1/blog/123.png');
  });

  it('propagates storage upload failures', async () => {
    const error = new Error('Storage unavailable');
    mocks.storageUpload.mockResolvedValueOnce({ error });

    await expect(
      uploadBlogImage('file:///hero.jpg', 'merchant-1')
    ).rejects.toBe(error);
  });
});
