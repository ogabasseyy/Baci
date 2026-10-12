import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BLOG_MEDIA_TOMBSTONE_TABLE } from './blog-media-tombstone-constants';
import { releaseBlogMediaPaths } from './blog-media-tombstone-release';

type Client = Parameters<typeof releaseBlogMediaPaths>[0];

const mockEq = vi.fn();
const mockIn = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn(() => ({
  delete: vi.fn(() => ({ in: mockIn })),
}));
const supabase = { from: mockFrom } as unknown as Client;

describe('releaseBlogMediaPaths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEq.mockResolvedValue({ error: null });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips the delete when no paths are given', async () => {
    await releaseBlogMediaPaths(supabase, []);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('deletes only unclaimed tombstones for the paths', async () => {
    await releaseBlogMediaPaths(supabase, ['platform/blog/a.webp']);
    expect(mockFrom).toHaveBeenCalledWith(BLOG_MEDIA_TOMBSTONE_TABLE);
    expect(mockIn).toHaveBeenCalledWith('path', ['platform/blog/a.webp']);
    expect(mockEq).toHaveBeenCalledWith('claimed', false);
  });

  it('logs and swallows a delete error', async () => {
    mockEq.mockResolvedValue({ error: new Error('db down') });
    await expect(
      releaseBlogMediaPaths(supabase, ['platform/blog/a.webp'])
    ).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      'Failed to release blog media tombstones',
      expect.objectContaining({ paths: ['platform/blog/a.webp'] })
    );
  });

  it('logs and swallows a thrown failure', async () => {
    mockIn.mockImplementationOnce(() => {
      throw new Error('down');
    });
    await expect(
      releaseBlogMediaPaths(supabase, ['platform/blog/a.webp'])
    ).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});
