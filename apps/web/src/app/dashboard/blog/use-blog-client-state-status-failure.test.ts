// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const requests = vi.hoisted(() => ({
  buildPostsQuery: vi.fn(() => new URLSearchParams('limit=20')),
  requestPosts: vi.fn(),
  requestUpdatePostStatus: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/use-debounce', () => ({
  useDebounce: (value: string) => value,
}));
vi.mock('@/hooks/use-merchant-features', () => ({
  useMerchantFeatures: () => ({ autoBlogEnabled: false }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('./actions', () => ({ getPreviewUrl: vi.fn() }));
vi.mock('./blog-client-requests', () => ({ blogClientRequests: requests }));
vi.mock('./blog-client-derived-state', () => ({
  blogClientDerivedState: {
    getDiscoverReadiness: () => ({ byPostId: new Map(), remediationCount: 0 }),
    getStats: (
      posts: { status: string; view_count: number }[],
      counts?: { draft: number; published: number; total: number }
    ) => ({
      drafts:
        counts?.draft ?? posts.filter((post) => post.status === 'draft').length,
      pageViews: 0,
      published:
        counts?.published ??
        posts.filter((post) => post.status === 'published').length,
      total: counts?.total ?? posts.length,
    }),
  },
}));

import type { BlogPost } from './blog-client-types';
import { useBlogClientState } from './use-blog-client-state';

const post: BlogPost = {
  author_name: 'Ada',
  category: null,
  created_at: '2026-01-01T00:00:00Z',
  excerpt: null,
  featured_image_height: null,
  featured_image_url: null,
  featured_image_variants: null,
  featured_image_width: null,
  id: 'post-1',
  published_at: null,
  reading_time_minutes: null,
  slug: 'post-1',
  status: 'draft',
  title: 'Draft post',
  updated_at: '2026-01-01T00:00:00Z',
  view_count: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
});

it('rolls the newest update back to the last confirmed status when both queued writes fail', async () => {
  let rejectFirst: (reason?: unknown) => void = () => undefined;
  let rejectSecond: (reason?: unknown) => void = () => undefined;
  requests.requestUpdatePostStatus
    .mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectFirst = reject;
      })
    )
    .mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectSecond = reject;
      })
    );
  const consoleError = vi
    .spyOn(console, 'error')
    .mockImplementation(() => undefined);
  const { result } = renderHook(() =>
    useBlogClientState({
      initialCounts: { archived: 0, draft: 1, published: 0, total: 1 },
      initialPosts: [post],
      merchant: { id: 'merchant-1', slug: 'demo' },
    })
  );

  try {
    let firstUpdate: Promise<void>;
    act(() => {
      firstUpdate = result.current.updatePostStatus(post.id, 'published');
    });
    let secondUpdate: Promise<void>;
    act(() => {
      secondUpdate = result.current.updatePostStatus(post.id, 'archived');
    });
    await waitFor(() =>
      expect(requests.requestUpdatePostStatus).toHaveBeenCalledTimes(1)
    );

    await act(async () => {
      rejectFirst(new Error('first offline'));
      await firstUpdate;
    });
    await waitFor(() =>
      expect(requests.requestUpdatePostStatus).toHaveBeenCalledTimes(2)
    );

    await act(async () => {
      rejectSecond(new Error('second offline'));
      await secondUpdate;
    });

    expect(result.current.posts[0]?.status).toBe('draft');
    expect(result.current.stats).toMatchObject({ drafts: 1, published: 0 });
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Error', variant: 'destructive' })
    );
  } finally {
    consoleError.mockRestore();
  }
});

it('rolls the newest failure back to an older confirmed queued write', async () => {
  let resolveFirst: (value: { status: BlogPost['status'] }) => void = () =>
    undefined;
  let rejectSecond: (reason?: unknown) => void = () => undefined;
  requests.requestUpdatePostStatus
    .mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      })
    )
    .mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectSecond = reject;
      })
    );
  const consoleError = vi
    .spyOn(console, 'error')
    .mockImplementation(() => undefined);
  const { result } = renderHook(() =>
    useBlogClientState({
      initialCounts: { archived: 0, draft: 1, published: 0, total: 1 },
      initialPosts: [post],
      merchant: { id: 'merchant-1', slug: 'demo' },
    })
  );

  try {
    let firstUpdate: Promise<void>;
    act(() => {
      firstUpdate = result.current.updatePostStatus(post.id, 'published');
    });
    let secondUpdate: Promise<void>;
    act(() => {
      secondUpdate = result.current.updatePostStatus(post.id, 'archived');
    });
    await waitFor(() =>
      expect(requests.requestUpdatePostStatus).toHaveBeenCalledTimes(1)
    );

    await act(async () => {
      resolveFirst({ status: 'published' });
      await firstUpdate;
    });
    await waitFor(() =>
      expect(requests.requestUpdatePostStatus).toHaveBeenCalledTimes(2)
    );
    toast.mockClear();

    await act(async () => {
      rejectSecond(new Error('offline'));
      await secondUpdate;
    });

    expect(result.current.posts[0]?.status).toBe('published');
    expect(result.current.stats).toMatchObject({ drafts: 0, published: 1 });
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Error', variant: 'destructive' })
    );
  } finally {
    consoleError.mockRestore();
  }
});
