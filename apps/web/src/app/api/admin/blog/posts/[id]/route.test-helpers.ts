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

export const blogPostSupabaseMock = {
  delete: vi.fn(),
  eq: vi.fn(),
  from: vi.fn(),
  is: vi.fn(),
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
