// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requests = vi.hoisted(() => ({
  buildPostsQuery: vi.fn(() => new URLSearchParams('limit=20')),
  requestDeletePost: vi.fn(),
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

describe('useBlogClientState deletePost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requests.requestPosts.mockResolvedValue({ hasMore: false, posts: [post] });
  });

  it('optimistically deletes then restores a post when the mutation fails', async () => {
    requests.requestDeletePost.mockRejectedValue(new Error('offline'));
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { result } = renderHook(() =>
      useBlogClientState({ initialPosts: [post], merchant })
    );
    try {
      act(() => result.current.setDeletePostId(post.id));
      await act(async () => result.current.deletePost());

      expect(result.current.posts).toEqual([post]);
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Error', variant: 'destructive' })
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('updates global stats for an optimistic delete and restores them on failure', async () => {
    let rejectDelete: (reason?: unknown) => void = () => undefined;
    requests.requestDeletePost.mockReturnValue(
      new Promise<void>((_resolve, reject) => {
        rejectDelete = reject;
      })
    );
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { result } = renderHook(() =>
      useBlogClientState({
        initialCounts: { archived: 1, draft: 2, published: 3, total: 6 },
        initialPosts: [post],
        merchant,
      })
    );

    try {
      act(() => result.current.setDeletePostId(post.id));
      let deleting: Promise<void>;
      act(() => {
        deleting = result.current.deletePost();
      });
      expect(result.current.stats).toMatchObject({ drafts: 1, total: 5 });

      await act(async () => {
        rejectDelete(new Error('offline'));
        await deleting;
      });

      expect(result.current.stats).toMatchObject({ drafts: 2, total: 6 });
    } finally {
      consoleError.mockRestore();
    }
  });

  it('does not restore a failed deletion into a merchant selected while it was pending', async () => {
    let rejectDelete: (reason?: unknown) => void = () => undefined;
    requests.requestDeletePost.mockReturnValue(
      new Promise<void>((_resolve, reject) => {
        rejectDelete = reject;
      })
    );
    requests.requestPosts.mockResolvedValue({
      counts: { archived: 0, draft: 1, published: 0, total: 1 },
      hasMore: false,
      posts: [otherPost],
    });
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { result, rerender } = renderHook(
      ({ currentMerchant }) =>
        useBlogClientState({
          initialCounts: { archived: 0, draft: 1, published: 0, total: 1 },
          initialPosts: [post],
          merchant: currentMerchant,
        }),
      { initialProps: { currentMerchant: merchant } }
    );

    try {
      act(() => result.current.setDeletePostId(post.id));
      let deleting: Promise<void>;
      act(() => {
        deleting = result.current.deletePost();
      });

      rerender({ currentMerchant: otherMerchant });
      await waitFor(() => expect(result.current.posts).toEqual([otherPost]));
      toast.mockClear();

      await act(async () => {
        rejectDelete(new Error('offline'));
        await deleting;
      });

      expect(result.current.posts).toEqual([otherPost]);
      expect(result.current.stats).toMatchObject({ drafts: 1, total: 1 });
      expect(toast).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('does not restore a failed deletion after returning to a later merchant session', async () => {
    let rejectDelete: (reason?: unknown) => void = () => undefined;
    requests.requestDeletePost.mockReturnValue(
      new Promise<void>((_resolve, reject) => {
        rejectDelete = reject;
      })
    );
    requests.requestPosts
      .mockResolvedValueOnce({
        counts: { archived: 0, draft: 1, published: 0, total: 1 },
        hasMore: false,
        posts: [otherPost],
      })
      .mockResolvedValueOnce({
        counts: { archived: 0, draft: 0, published: 1, total: 1 },
        hasMore: false,
        posts: [laterMerchantPost],
      });
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { result, rerender } = renderHook(
      ({ currentMerchant }) =>
        useBlogClientState({
          initialCounts: { archived: 0, draft: 1, published: 0, total: 1 },
          initialPosts: [post],
          merchant: currentMerchant,
        }),
      { initialProps: { currentMerchant: merchant } }
    );

    try {
      act(() => result.current.setDeletePostId(post.id));
      let deleting: Promise<void>;
      act(() => {
        deleting = result.current.deletePost();
      });

      rerender({ currentMerchant: otherMerchant });
      await waitFor(() => expect(result.current.posts).toEqual([otherPost]));
      rerender({ currentMerchant: merchant });
      await waitFor(() =>
        expect(result.current.posts).toEqual([laterMerchantPost])
      );
      toast.mockClear();

      await act(async () => {
        rejectDelete(new Error('offline'));
        await deleting;
      });

      expect(result.current.posts).toEqual([laterMerchantPost]);
      expect(result.current.stats).toMatchObject({ published: 1, total: 1 });
      expect(toast).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
