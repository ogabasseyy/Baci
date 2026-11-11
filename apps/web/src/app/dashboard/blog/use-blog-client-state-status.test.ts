// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
      published:
        counts?.published ??
        posts.filter((post) => post.status === 'published').length,
      total: counts?.total ?? posts.length,
      pageViews: posts.reduce((total, post) => total + post.view_count, 0),
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
const otherPost: BlogPost = {
  ...post,
  id: 'post-2',
  slug: 'post-2',
  title: 'Other draft',
};
const laterMerchantPost: BlogPost = {
  ...post,
  id: 'post-3',
  slug: 'post-3',
  status: 'published',
  title: 'Later merchant post',
};
const merchant = { id: 'merchant-1', slug: 'demo' };
const otherMerchant = { id: 'merchant-2', slug: 'other' };
const aCounts = { archived: 0, draft: 1, published: 0, total: 1 };
const bCounts = { archived: 0, draft: 1, published: 0, total: 1 };
const laterACounts = { archived: 0, draft: 0, published: 1, total: 1 };

describe('useBlogClientState updatePostStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requests.requestPosts.mockResolvedValue({ hasMore: false, posts: [post] });
  });

  it('does not roll back a failed status update into a merchant selected while it was pending', async () => {
    let rejectStatusUpdate: (reason?: unknown) => void = () => undefined;
    requests.requestUpdatePostStatus.mockReturnValue(
      new Promise<void>((_resolve, reject) => {
        rejectStatusUpdate = reject;
      })
    );
    requests.requestPosts.mockResolvedValue({
      counts: bCounts,
      hasMore: false,
      posts: [otherPost],
    });
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { result, rerender } = renderHook(
      ({ currentMerchant }) =>
        useBlogClientState({
          initialCounts: aCounts,
          initialPosts: [post],
          merchant: currentMerchant,
        }),
      { initialProps: { currentMerchant: merchant } }
    );

    try {
      let updating: Promise<void>;
      act(() => {
        updating = result.current.updatePostStatus(post.id, 'published');
      });

      rerender({ currentMerchant: otherMerchant });
      await waitFor(() => expect(result.current.posts).toEqual([otherPost]));
      toast.mockClear();

      await act(async () => {
        rejectStatusUpdate(new Error('offline'));
        await updating;
      });

      expect(result.current.posts).toEqual([otherPost]);
      expect(result.current.stats).toMatchObject({ drafts: 1, published: 0 });
      expect(toast).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('does not roll back a failed status update after returning to a later merchant session', async () => {
    let rejectStatusUpdate: (reason?: unknown) => void = () => undefined;
    requests.requestUpdatePostStatus.mockReturnValue(
      new Promise<void>((_resolve, reject) => {
        rejectStatusUpdate = reject;
      })
    );
    requests.requestPosts
      .mockResolvedValueOnce({
        counts: bCounts,
        hasMore: false,
        posts: [otherPost],
      })
      .mockResolvedValueOnce({
        counts: laterACounts,
        hasMore: false,
        posts: [laterMerchantPost],
      });
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { result, rerender } = renderHook(
      ({ currentMerchant }) =>
        useBlogClientState({
          initialCounts: aCounts,
          initialPosts: [post],
          merchant: currentMerchant,
        }),
      { initialProps: { currentMerchant: merchant } }
    );

    try {
      let updating: Promise<void>;
      act(() => {
        updating = result.current.updatePostStatus(post.id, 'published');
      });

      rerender({ currentMerchant: otherMerchant });
      await waitFor(() => expect(result.current.posts).toEqual([otherPost]));
      rerender({ currentMerchant: merchant });
      await waitFor(() =>
        expect(result.current.posts).toEqual([laterMerchantPost])
      );
      toast.mockClear();

      await act(async () => {
        rejectStatusUpdate(new Error('offline'));
        await updating;
      });

      expect(result.current.posts).toEqual([laterMerchantPost]);
      expect(result.current.stats).toMatchObject({ drafts: 0, published: 1 });
      expect(toast).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it.each([
    'success',
    'failure',
  ] as const)('serializes writes and ignores an older %s completion after a newer status update', async (olderCompletion) => {
    let rejectOlderUpdate: (reason?: unknown) => void = () => undefined;
    let resolveOlderUpdate: (value: { status: BlogPost['status'] }) => void =
      () => undefined;
    let resolveNewerUpdate: (value: { status: BlogPost['status'] }) => void =
      () => undefined;
    requests.requestUpdatePostStatus
      .mockReturnValueOnce(
        new Promise<{ status: BlogPost['status'] }>((resolve, reject) => {
          resolveOlderUpdate = resolve;
          rejectOlderUpdate = reject;
        })
      )
      .mockReturnValueOnce(
        new Promise<{ status: BlogPost['status'] }>((resolve) => {
          resolveNewerUpdate = resolve;
        })
      );
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { result } = renderHook(() =>
      useBlogClientState({
        initialCounts: aCounts,
        initialPosts: [post],
        merchant,
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
      expect(result.current.posts[0]?.status).toBe('archived');
      expect(result.current.stats).toMatchObject({
        drafts: 0,
        published: 0,
      });

      await act(async () => {
        if (olderCompletion === 'success') {
          resolveOlderUpdate({ status: 'published' });
        } else {
          rejectOlderUpdate(new Error('offline'));
        }
        await firstUpdate;
      });
      await waitFor(() =>
        expect(requests.requestUpdatePostStatus).toHaveBeenCalledTimes(2)
      );

      expect(result.current.posts[0]?.status).toBe('archived');
      expect(result.current.stats).toMatchObject({
        drafts: 0,
        published: 0,
      });
      expect(toast).not.toHaveBeenCalled();

      await act(async () => {
        resolveNewerUpdate({ status: 'archived' });
        await secondUpdate;
      });

      expect(result.current.posts[0]?.status).toBe('archived');
      expect(toast).toHaveBeenCalledTimes(1);
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Post Archived' })
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
