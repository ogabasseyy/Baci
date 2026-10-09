import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetPlatformAdminAuthForPermission = vi.fn();
const mockCreateClient = vi.fn();
const mockCheckCsrfProtection = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockRevalidatePlatformBlog = vi.fn();
const mockGenerateFeaturedImageVariants = vi.fn();

vi.mock('@/lib/platform-admin-auth', () => ({
  getPlatformAdminAuthForPermission: (...args: unknown[]) =>
    mockGetPlatformAdminAuthForPermission(...args),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrfProtection(...args),
}));

vi.mock('@/lib/rate-limiter', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

vi.mock('@/lib/cache-revalidation', () => ({
  revalidatePlatformBlog: (...args: unknown[]) =>
    mockRevalidatePlatformBlog(...args),
}));

vi.mock('@/lib/blog-featured-image-variants', () => ({
  BlogFeaturedImageError: class BlogFeaturedImageError extends Error {},
  generateFeaturedImageVariants: (...args: unknown[]) =>
    mockGenerateFeaturedImageVariants(...args),
}));

const mockStorageBucket = {
  remove: vi.fn(),
  upload: vi.fn(),
};

const mockUpsert = vi.fn();
const mockDeleteEq = vi.fn();
const mockDeleteIn = vi.fn((_column: string, _paths: string[]) => ({
  eq: mockDeleteEq,
}));

const mockSupabase = {
  from: vi.fn(() => ({
    delete: vi.fn(() => ({ in: mockDeleteIn })),
    upsert: mockUpsert,
  })),
  storage: {
    from: vi.fn(() => mockStorageBucket),
  },
};

import { POST } from './route';

function featuredRequest() {
  const file = new File(['file-bytes'], 'photo.jpg', { type: 'image/jpeg' });
  return {
    formData: vi.fn().mockResolvedValue({
      get: (key: string) => {
        if (key === 'file') return file;
        if (key === 'purpose') return 'featured';
        return null;
      },
    }),
  } as unknown as NextRequest;
}

function stagedPaths(call: unknown[]): string[] {
  const rows = call[0] as { path: string }[];
  return rows.map((row) => row.path);
}

describe('POST /api/admin/blog/upload featured staging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue(mockSupabase);
    mockGetPlatformAdminAuthForPermission.mockResolvedValue({
      status: 'authenticated',
      user: { email: 'admin@baci.com', id: 'user-1' },
    });
    mockCheckCsrfProtection.mockResolvedValue({ valid: true, response: null });
    mockCheckRateLimit.mockResolvedValue(true);
    mockStorageBucket.upload.mockResolvedValue({ error: null });
    mockStorageBucket.remove.mockResolvedValue({ error: null });
    mockUpsert.mockResolvedValue({ error: null });
    mockDeleteEq.mockResolvedValue({ error: null });
    mockGenerateFeaturedImageVariants.mockResolvedValue({
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
      },
    });
  });

  it('stages each object before its storage write', async () => {
    // Termination can strike between any two awaits: every tombstone
    // must precede its storage write, or the completed object is a
    // permanent orphan the cron can never see. Invocation order
    // proves the interleaving.
    const response = await POST(featuredRequest());

    expect(response.status).toBe(200);
    const uploads = mockStorageBucket.upload.mock.calls;
    expect(uploads).toHaveLength(3);
    const [sourcePath, firstVariant, secondVariant] = uploads.map(
      (call) => call[0] as string
    );
    const upserts = mockUpsert.mock.calls;
    expect(upserts).toHaveLength(3);
    const orderOf = (
      mock: { mock: { invocationCallOrder: number[] } },
      index: number
    ) => mock.mock.invocationCallOrder[index] ?? Number.POSITIVE_INFINITY;
    const stageIndexFor = (path: string) =>
      upserts.findIndex((call) => stagedPaths(call).includes(path));
    // Each object's tombstone precedes its own write, so no write
    // is ever unstaged when the invocation dies.
    for (const [uploadIndex, path] of [
      sourcePath,
      firstVariant,
      secondVariant,
    ].entries()) {
      const stageIndex = stageIndexFor(path as string);
      expect(stageIndex).toBeGreaterThanOrEqual(0);
      expect(orderOf(mockUpsert, stageIndex)).toBeLessThan(
        orderOf(mockStorageBucket.upload, uploadIndex)
      );
    }
    // Generation runs after the source is already reclaimable.
    expect(orderOf(mockGenerateFeaturedImageVariants, 0)).toBeGreaterThan(
      orderOf(mockUpsert, stageIndexFor(sourcePath as string))
    );
  });

  it('writes nothing for a variant whose staging fails', async () => {
    // The failing variant never reaches storage; its completed
    // siblings stay staged for the sweep and the 500 carries no
    // unstaged orphan.
    mockUpsert
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'down' } });

    const response = await POST(featuredRequest());

    expect(response.status).toBe(500);
    // Source staged and written; first variant staged-then-failed.
    expect(mockStorageBucket.upload).toHaveBeenCalledTimes(1);
    const staged = mockUpsert.mock.calls.flatMap(stagedPaths);
    expect(staged[0]).toMatch(/^platform\/blog\/.+\.jpg$/);
  });

  it('releases tombstones for confirmed removals after a variant failure', async () => {
    // The source and first variant upload, the second variant
    // fails, cleanup removes both objects, and both tombstones
    // release: nothing lingers in Storage or the sweep queue.
    mockGenerateFeaturedImageVariants.mockResolvedValue({
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
      },
    });
    mockStorageBucket.upload
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'storage down' } });

    const response = await POST(featuredRequest());

    expect(response.status).toBe(500);
    // The failed variant's tombstone releases in the helper; the
    // route releases the source plus the completed sibling after
    // their removal is confirmed.
    const releases = mockDeleteIn.mock.calls.map(([, paths]) => paths);
    expect(releases).toHaveLength(2);
    expect(releases.some((paths) => paths.length === 2)).toBe(true);
    expect(mockDeleteEq).toHaveBeenCalledWith('claimed', false);
  });

  it('retains tombstones when compensating cleanup fails', async () => {
    // Removal errors leave the objects in Storage; releasing their
    // tombstones would orphan media the sweep can never retry. Only
    // the failed variant's own tombstone releases (its write never
    // happened); the uploaded source keeps its tombstone.
    mockStorageBucket.upload
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'storage down' } });
    mockStorageBucket.remove.mockResolvedValueOnce({
      error: { message: 'remove down' },
    });

    const response = await POST(featuredRequest());

    expect(response.status).toBe(500);
    expect(mockDeleteIn).toHaveBeenCalledTimes(1);
    expect(mockDeleteIn).toHaveBeenCalledWith('path', [
      expect.stringContaining('landscape_16x9.webp'),
    ]);
  });
});
