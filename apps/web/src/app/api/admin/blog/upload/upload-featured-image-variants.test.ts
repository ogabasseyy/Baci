import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlogFeaturedImageVariantsResult } from '@/lib/blog-featured-image-variants';
import { uploadFeaturedImageVariants } from './upload-featured-image-variants';

const mockUpload = vi.fn();
const mockRemove = vi.fn();
const mockUpsert = vi.fn();
const mockDeleteEq = vi.fn();
const mockDeleteIn = vi.fn(() => ({ eq: mockDeleteEq }));
const mockDelete = vi.fn(() => ({ in: mockDeleteIn }));
const mockFrom = vi.fn(() => ({ delete: mockDelete, upsert: mockUpsert }));

const mockSupabase = {
  from: mockFrom,
  storage: {
    from: vi.fn(() => ({ remove: mockRemove, upload: mockUpload })),
  },
};

function generated(
  overrides: Record<string, unknown> = {}
): BlogFeaturedImageVariantsResult {
  return {
    source: { height: 800, totalPixels: 960000, width: 1200 },
    variants: {
      landscape_16x9: {
        buffer: Buffer.from('landscape'),
        contentType: 'image/webp',
        height: 675,
        key: 'landscape_16x9',
        width: 1200,
      },
      square_1x1: {
        buffer: Buffer.from('square'),
        contentType: 'image/webp',
        height: 800,
        key: 'square_1x1',
        width: 800,
      },
      ...overrides,
    },
  } as BlogFeaturedImageVariantsResult;
}

describe('uploadFeaturedImageVariants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpload.mockResolvedValue({ error: null });
    mockRemove.mockResolvedValue({ error: null });
    mockUpsert.mockResolvedValue({ error: null });
    mockDeleteEq.mockResolvedValue({ error: null });
  });

  it('stages each variant before its storage write', async () => {
    const uploadedPaths: string[] = [];

    const result = await uploadFeaturedImageVariants(
      mockSupabase as never,
      'token-1',
      generated(),
      uploadedPaths
    );

    expect(mockUpload).toHaveBeenCalledTimes(2);
    expect(mockUpsert).toHaveBeenCalledTimes(2);
    // Each tombstone precedes its own write: termination between
    // staging and upload leaves a sweepable record, never an orphan.
    const uploadOrder = mockUpload.mock.invocationCallOrder;
    const upsertOrder = mockUpsert.mock.invocationCallOrder;
    for (const index of [0, 1]) {
      expect(upsertOrder[index] ?? Number.POSITIVE_INFINITY).toBeLessThan(
        uploadOrder[index] ?? Number.NEGATIVE_INFINITY
      );
    }
    expect(uploadedPaths).toEqual([
      expect.stringContaining('token-1/landscape_16x9.webp'),
      expect.stringContaining('token-1/square_1x1.webp'),
    ]);
    expect(result).toEqual({
      variants: {
        landscape_16x9: expect.objectContaining({
          contentType: 'image/webp',
          height: 675,
          width: 1200,
        }),
        square_1x1: expect.objectContaining({
          contentType: 'image/webp',
          height: 800,
          width: 800,
        }),
      },
    });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('skips undefined variants without uploading', async () => {
    const uploadedPaths: string[] = [];

    const result = await uploadFeaturedImageVariants(
      mockSupabase as never,
      'token-1',
      generated({ square_1x1: undefined }),
      uploadedPaths
    );

    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(uploadedPaths).toHaveLength(1);
    expect(result).toEqual({
      variants: { landscape_16x9: expect.objectContaining({}) },
    });
  });

  it('releases the pre-staged tombstone and throws when a variant upload fails', async () => {
    mockUpload
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'storage down' } });
    const uploadedPaths: string[] = [];

    await expect(
      uploadFeaturedImageVariants(
        mockSupabase as never,
        'token-1',
        generated(),
        uploadedPaths
      )
    ).rejects.toEqual({ message: 'storage down' });

    // The completed sibling stays staged for the sweep; only the
    // failed variant's pre-staged tombstone releases.
    expect(uploadedPaths).toEqual([
      expect.stringContaining('token-1/landscape_16x9.webp'),
    ]);
    expect(mockDeleteIn).toHaveBeenCalledWith('path', [
      expect.stringContaining('token-1/square_1x1.webp'),
    ]);
    expect(mockDeleteEq).toHaveBeenCalledWith('claimed', false);
  });

  it('returns the staging response without writing when staging fails', async () => {
    mockUpsert
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'db down' } });
    const uploadedPaths: string[] = [];

    const result = await uploadFeaturedImageVariants(
      mockSupabase as never,
      'token-1',
      generated(),
      uploadedPaths
    );

    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(uploadedPaths).toEqual([
      expect.stringContaining('token-1/landscape_16x9.webp'),
    ]);
    expect(result).toHaveProperty('response');
    // Nothing was written for the failed variant, so nothing releases.
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('returns empty variants without calling storage', async () => {
    const uploadedPaths: string[] = [];

    const result = await uploadFeaturedImageVariants(
      mockSupabase as never,
      'token-1',
      generated({ landscape_16x9: undefined, square_1x1: undefined }),
      uploadedPaths
    );

    expect(result).toEqual({ variants: {} });
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(uploadedPaths).toHaveLength(0);
  });
});
