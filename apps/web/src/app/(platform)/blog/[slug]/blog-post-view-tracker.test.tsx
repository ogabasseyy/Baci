import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetchWithCsrf = vi.fn();

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: (...args: unknown[]) => mockFetchWithCsrf(...args),
}));

import { BlogPostViewTracker } from './blog-post-view-tracker';

describe('BlogPostViewTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchWithCsrf.mockResolvedValue(new Response(null, { status: 200 }));
  });

  it('tracks views with a normalized slug using CSRF protection', async () => {
    render(<BlogPostViewTracker slug=" Launch-Faster " />);

    await waitFor(() => {
      expect(mockFetchWithCsrf).toHaveBeenCalledTimes(1);
    });
    expect(mockFetchWithCsrf).toHaveBeenCalledWith(
      '/api/blog/posts',
      expect.objectContaining({
        body: JSON.stringify({ slug: 'launch-faster' }),
        cache: 'no-store',
        keepalive: true,
        method: 'POST',
      })
    );
  });

  it('skips tracking when the slug is empty', () => {
    render(<BlogPostViewTracker slug="   " />);

    expect(mockFetchWithCsrf).not.toHaveBeenCalled();
  });
});
