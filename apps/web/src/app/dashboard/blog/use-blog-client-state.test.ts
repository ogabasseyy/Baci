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
const merchant = { id: 'merchant-1', slug: 'demo' };
const otherMerchant = { id: 'merchant-2', slug: 'other' };

describe('useBlogClientState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requests.requestPosts.mockResolvedValue({ hasMore: false, posts: [post] });
  });

  it('loads posts and resets pagination when filter inputs change', async () => {
    const { result } = renderHook(() =>
      useBlogClientState({ initialPosts: [], merchant })
    );
    await waitFor(() => expect(result.current.posts).toEqual([post]));

    act(() => {
      result.current.setPage(() => 3);
      result.current.selectStatus('published');
    });

    await waitFor(() => expect(result.current.page).toBe(1));
    expect(requests.requestPosts).toHaveBeenCalled();
  });

  it('resets search and opens the published filter for Discover remediation', async () => {
    const { result } = renderHook(() =>
      useBlogClientState({ initialPosts: [post], merchant })
    );

    act(() => result.current.changeSearch('missing image'));
    expect(result.current.searchQuery).toBe('missing image');

    act(() => result.current.showDiscoverRemediation());

    expect(result.current.searchQuery).toBe('');
    expect(result.current.statusFilter).toBe('published');
    expect(result.current.page).toBe(1);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it('does not fetch again when the server supplied the initial list', async () => {
    renderHook(() => useBlogClientState({ initialPosts: [post], merchant }));

    await Promise.resolve();

    expect(requests.requestPosts).not.toHaveBeenCalled();
  });

  it('clears the previous merchant list before loading the next merchant', async () => {
    requests.requestPosts.mockResolvedValue({ hasMore: false, posts: [] });
    const { result, rerender } = renderHook(
      ({ currentMerchant }) =>
        useBlogClientState({ initialPosts: [post], merchant: currentMerchant }),
      { initialProps: { currentMerchant: merchant } }
    );

    rerender({ currentMerchant: otherMerchant });

    expect(result.current.posts).toEqual([]);
    expect(result.current.isLoading).toBe(true);
    await waitFor(() =>
      expect(requests.requestPosts).toHaveBeenCalledWith(expect.anything())
    );
  });

  it('merges a successful status update into the matching post', async () => {
    requests.requestUpdatePostStatus.mockResolvedValue({ status: 'published' });
    const { result } = renderHook(() =>
      useBlogClientState({ initialPosts: [post], merchant })
    );
    expect(result.current.posts).toEqual([post]);

    await act(async () =>
      result.current.updatePostStatus(post.id, 'published')
    );

    expect(result.current.posts[0]?.status).toBe('published');
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Post Published' })
    );
  });

  it('optimistically updates stats and restores them after a rejected status update', async () => {
    requests.requestUpdatePostStatus.mockRejectedValue(new Error('offline'));
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { result } = renderHook(() =>
      useBlogClientState({
        initialCounts: { archived: 0, draft: 1, published: 0, total: 1 },
        initialPosts: [post],
        merchant,
      })
    );

    try {
      await act(async () =>
        result.current.updatePostStatus(post.id, 'published')
      );

      expect(result.current.posts[0]?.status).toBe('draft');
      expect(result.current.stats).toMatchObject({ drafts: 1, published: 0 });
    } finally {
      consoleError.mockRestore();
    }
  });
});
