import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLATFORM_BLOG_PAGE_SIZE } from './blog-pagination';

const mockBlogListClient = vi.fn((_props: unknown) => (
  <div>Platform blog list</div>
));
const mockCreateClient = vi.fn();
const mockGetPlatformAdminAuthForPermission = vi.fn();
const mockRedirect = vi.fn((destination: string) => {
  throw new Error(`NEXT_REDIRECT:${destination}`);
});

vi.mock('@/app/admin/blog/blog-list-client', () => ({
  BlogListClient: (props: unknown) => mockBlogListClient(props),
}));

vi.mock('next/navigation', () => ({
  redirect: (destination: string) => mockRedirect(destination),
}));

vi.mock('@/lib/platform-admin-auth', () => ({
  getPlatformAdminAuthForPermission: (...args: unknown[]) =>
    mockGetPlatformAdminAuthForPermission(...args),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

const mockSupabase = {
  eq: vi.fn(),
  from: vi.fn(),
  is: vi.fn(),
  order: vi.fn(),
  range: vi.fn(),
  select: vi.fn(),
};

mockSupabase.from.mockReturnValue(mockSupabase);
mockSupabase.select.mockReturnValue(mockSupabase);
mockSupabase.eq.mockReturnValue(mockSupabase);
mockSupabase.is.mockReturnValue(mockSupabase);
mockSupabase.order.mockReturnValue(mockSupabase);

import AdminBlogPage from './page';

describe('/admin/blog page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlatformAdminAuthForPermission.mockResolvedValue({
      status: 'authenticated',
      user: { email: 'admin@example.com', id: 'admin-1' },
    });
    mockCreateClient.mockResolvedValue(mockSupabase);
    mockSupabase.range.mockResolvedValue({
      count: 1,
      data: [
        {
          id: 'post-1',
          slug: 'launch-faster',
          status: 'draft',
          title: 'Launch Faster',
        },
      ],
      error: null,
    });
  });

  it('passes server-loaded posts into BlogListClient', async () => {
    render(await AdminBlogPage());

    expect(mockGetPlatformAdminAuthForPermission).toHaveBeenCalledWith(
      'content.manage'
    );
    expect(screen.getByText('Platform blog list')).toBeInTheDocument();
    expect(mockBlogListClient).toHaveBeenCalledWith(
      expect.objectContaining({
        initialError: null,
        initialHasMore: false,
        initialPosts: [
          {
            id: 'post-1',
            slug: 'launch-faster',
            status: 'draft',
            title: 'Launch Faster',
          },
        ],
        pageSize: PLATFORM_BLOG_PAGE_SIZE,
      })
    );
  });

  it('passes an error message when the server query fails', async () => {
    mockSupabase.range.mockResolvedValueOnce({
      count: null,
      data: null,
      error: { message: 'boom' },
    });

    render(await AdminBlogPage());

    expect(mockBlogListClient).toHaveBeenCalledWith(
      expect.objectContaining({
        initialError: 'Failed to load platform blog posts',
        initialHasMore: false,
        initialPosts: [],
        pageSize: PLATFORM_BLOG_PAGE_SIZE,
      })
    );
  });

  it('enables load more when server count exceeds first page size', async () => {
    mockSupabase.range.mockResolvedValueOnce({
      count: PLATFORM_BLOG_PAGE_SIZE + 1,
      data: Array.from({ length: PLATFORM_BLOG_PAGE_SIZE }, (_, index) => ({
        id: `post-${index + 1}`,
        slug: `post-${index + 1}`,
        status: 'draft',
        title: `Post ${index + 1}`,
      })),
      error: null,
    });

    render(await AdminBlogPage());

    expect(mockBlogListClient).toHaveBeenCalledWith(
      expect.objectContaining({
        initialHasMore: true,
      })
    );
  });

  it('redirects unauthenticated users to login', async () => {
    mockGetPlatformAdminAuthForPermission.mockResolvedValueOnce({
      status: 'unauthenticated',
    });

    await expect(AdminBlogPage()).rejects.toThrow(
      'NEXT_REDIRECT:/login?redirect=%2Fadmin'
    );
    expect(mockRedirect).toHaveBeenCalledWith('/login?redirect=%2Fadmin');
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('redirects non-content roles to dashboard', async () => {
    mockGetPlatformAdminAuthForPermission.mockResolvedValueOnce({
      status: 'forbidden',
    });

    await expect(AdminBlogPage()).rejects.toThrow('NEXT_REDIRECT:/dashboard');
    expect(mockRedirect).toHaveBeenCalledWith('/dashboard');
    expect(mockGetPlatformAdminAuthForPermission).toHaveBeenCalledWith(
      'content.manage'
    );
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});
