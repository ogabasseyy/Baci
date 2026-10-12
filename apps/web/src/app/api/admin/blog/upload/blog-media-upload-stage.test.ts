import { describe, expect, it, vi } from 'vitest';

const mockTombstone = vi.fn();
const mockCleanup = vi.fn();

vi.mock('./blog-media-tombstone-write', () => ({
  tombstoneBlogMediaPaths: (...args: unknown[]) => mockTombstone(...args),
}));

vi.mock('./upload-helpers', async (importOriginal) => {
  const original = await importOriginal<typeof import('./upload-helpers')>();
  return {
    ...original,
    cleanupUploadedPaths: (...args: unknown[]) => mockCleanup(...args),
  };
});

import { stageUploadedBlogMediaPaths } from './blog-media-upload-stage';

describe('stageUploadedBlogMediaPaths', () => {
  it('returns null when staging succeeds', async () => {
    mockTombstone.mockResolvedValueOnce(true);

    const result = await stageUploadedBlogMediaPaths({} as never, [
      'platform/blog/a.webp',
    ]);

    expect(result).toBeNull();
    expect(mockTombstone).toHaveBeenCalledWith({}, ['platform/blog/a.webp']);
    expect(mockCleanup).not.toHaveBeenCalled();
  });

  it('removes just-uploaded objects and fails when staging fails', async () => {
    mockTombstone.mockResolvedValueOnce(false);

    const result = await stageUploadedBlogMediaPaths({} as never, [
      'platform/blog/a.webp',
    ]);

    expect(mockCleanup).toHaveBeenCalledWith({}, ['platform/blog/a.webp']);
    expect(result?.status).toBe(500);
    await expect(result?.json()).resolves.toEqual({
      code: 'UPLOAD_FAILED',
      error: 'Failed to upload file',
    });
  });
});
