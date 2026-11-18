import { describe, expect, it, vi } from 'vitest';

const mockPublishScheduledPosts = vi.fn();

vi.mock('dotenv/config', () => ({}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({}),
}));
vi.mock(
  '@/app/api/cron/publish-scheduled-posts/publish-scheduled-posts-workflow',
  () => ({
    publishScheduledPosts: (...args: unknown[]) =>
      mockPublishScheduledPosts(...args),
  })
);

import { runPublishScheduledPostsCli } from './publish-scheduled-posts';

describe('publish-scheduled-posts CLI', () => {
  it('returns 0 on 200 and 1 on >= 400', async () => {
    mockPublishScheduledPosts.mockResolvedValueOnce(
      new Response('ok', { status: 200 })
    );
    await expect(runPublishScheduledPostsCli()).resolves.toBe(0);

    mockPublishScheduledPosts.mockResolvedValueOnce(
      new Response('err', { status: 500 })
    );
    await expect(runPublishScheduledPostsCli()).resolves.toBe(1);
  });
});
