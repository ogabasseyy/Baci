import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sweep = vi.hoisted(() => vi.fn());
vi.mock('@/app/api/admin/blog/upload/blog-media-tombstone-sweep', () => ({
  sweepDueBlogMediaTombstones: sweep,
}));
vi.mock('@/lib/blog-media-sweep-worker-client', () => ({
  createBlogMediaSweepWorkerClient: vi.fn(() => ({})),
}));

import { GET } from './route';

describe('GET /api/cron/cleanup-blog-media-tombstones', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    sweep.mockResolvedValue({
      resurrected: [],
      swept: ['platform/blog/old.webp'],
    });
  });

  it('rejects unauthenticated requests before sweeping', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/cron/cleanup-blog-media-tombstones')
    );

    expect(response.status).toBe(401);
    expect(sweep).not.toHaveBeenCalled();
  });

  it('returns sweep counts for an authenticated request', async () => {
    const response = await GET(
      new NextRequest(
        'http://localhost/api/cron/cleanup-blog-media-tombstones',
        { headers: { authorization: 'Bearer cron-secret' } }
      )
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      resurrected: [],
      swept: ['platform/blog/old.webp'],
    });
    expect(sweep).toHaveBeenCalledOnce();
  });

  it('fails closed when the sweep cannot verify safety', async () => {
    sweep.mockResolvedValueOnce(null);

    const response = await GET(
      new NextRequest(
        'http://localhost/api/cron/cleanup-blog-media-tombstones',
        { headers: { authorization: 'Bearer cron-secret' } }
      )
    );

    expect(response.status).toBe(500);
  });
});
