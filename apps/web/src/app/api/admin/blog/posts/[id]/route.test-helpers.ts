import { vi } from 'vitest';

const blogPostRouteMocks = vi.hoisted(() => ({
  checkCsrfProtection: vi.fn(),
  createClient: vi.fn(),
  getPlatformAdminAuthForPermission: vi.fn(),
  revalidatePlatformBlog: vi.fn(),
}));

export function getBlogPostRouteMocks() {
  return blogPostRouteMocks;
}

vi.mock('@/lib/platform-admin-auth', () => ({
  getPlatformAdminAuthForPermission: (...args: unknown[]) =>
    blogPostRouteMocks.getPlatformAdminAuthForPermission(...args),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: (...args: unknown[]) =>
    blogPostRouteMocks.createClient(...args),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) =>
    blogPostRouteMocks.checkCsrfProtection(...args),
}));
vi.mock('@/lib/cache-revalidation', () => ({
  revalidatePlatformBlog: (...args: unknown[]) =>
    blogPostRouteMocks.revalidatePlatformBlog(...args),
}));

type BlogPostRpcResponse = {
  data: Record<string, unknown>[];
  error: null;
};

export const blogPostSupabaseMock = {
  delete: vi.fn(),
  eq: vi.fn(),
  from: vi.fn(),
  in: vi.fn(() => Promise.resolve({ data: [], error: null })),
  is: vi.fn(),
  rpc: vi.fn(
    (
      name: string,
      args: Record<string, unknown>
    ): Promise<BlogPostRpcResponse> => {
      if (name === 'mutate_platform_blog_post_atomic') {
        return Promise.resolve({
          data: [
            { id: 'post-1', slug: 'launch-faster', title: 'Launch Faster' },
          ],
          error: null,
        });
      }
      const paths = (args.p_paths as string[] | undefined) ?? [];
      return Promise.resolve({
        data: paths.map((path) => ({ path })),
        error: null,
      });
    }
  ),
  select: vi.fn(),
  single: vi.fn(),
  update: vi.fn(),
};

blogPostSupabaseMock.from.mockReturnValue(blogPostSupabaseMock);
blogPostSupabaseMock.select.mockReturnValue(blogPostSupabaseMock);
blogPostSupabaseMock.eq.mockReturnValue(blogPostSupabaseMock);
blogPostSupabaseMock.is.mockReturnValue(blogPostSupabaseMock);
blogPostSupabaseMock.update.mockReturnValue(blogPostSupabaseMock);
blogPostSupabaseMock.delete.mockReturnValue(blogPostSupabaseMock);

export function atomicPatchData(): Record<string, unknown> {
  const calls = blogPostSupabaseMock.rpc.mock.calls as [
    string,
    Record<string, unknown>,
  ][];
  const match = calls.find(
    ([name]) => name === 'mutate_platform_blog_post_atomic'
  );
  if (!match) throw new Error('atomic RPC was not called');
  return match[1].p_post_data as Record<string, unknown>;
}

export function mockAtomicRow(row: Record<string, unknown>) {
  blogPostSupabaseMock.rpc.mockResolvedValueOnce({
    data: [row],
    error: null,
  });
}

export function blogPostRouteContext(id = 'post-1') {
  return { params: Promise.resolve({ id }) };
}

export function resetBlogPostRouteMocks() {
  vi.clearAllMocks();
  blogPostRouteMocks.createClient.mockResolvedValue(blogPostSupabaseMock);
  blogPostRouteMocks.getPlatformAdminAuthForPermission.mockResolvedValue({
    status: 'authenticated',
    user: { email: 'admin@baci.com', id: 'user-1' },
  });
  blogPostRouteMocks.checkCsrfProtection.mockResolvedValue({
    valid: true,
    response: null,
  });
  blogPostSupabaseMock.single.mockResolvedValue({
    data: { id: 'post-1', slug: 'launch-faster', title: 'Launch Faster' },
    error: null,
  });
}
