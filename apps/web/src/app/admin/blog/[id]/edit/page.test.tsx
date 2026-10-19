import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockBlogEditorClient = vi.fn((_props: unknown) => (
  <div>Blog editor client</div>
));
const mockCreateClient = vi.fn();
const mockGetPlatformAdminAuthForPermission = vi.fn();
const mockNotFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
const mockRedirect = vi.fn((destination: string) => {
  throw new Error(`NEXT_REDIRECT:${destination}`);
});

vi.mock('@/app/admin/blog/blog-editor-client', () => ({
  BlogEditorClient: (props: unknown) => mockBlogEditorClient(props),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

vi.mock('@/lib/platform-admin-auth', () => ({
  getPlatformAdminAuthForPermission: (...args: unknown[]) =>
    mockGetPlatformAdminAuthForPermission(...args),
}));

vi.mock('next/navigation', () => ({
  notFound: () => mockNotFound(),
  redirect: (destination: string) => mockRedirect(destination),
}));

const mockSupabase = {
  eq: vi.fn(),
  from: vi.fn(),
  is: vi.fn(),
  select: vi.fn(),
  single: vi.fn(),
};

mockSupabase.from.mockReturnValue(mockSupabase);
mockSupabase.select.mockReturnValue(mockSupabase);
mockSupabase.eq.mockReturnValue(mockSupabase);
mockSupabase.is.mockReturnValue(mockSupabase);

import EditAdminBlogPostPage from './page';

describe('/admin/blog/[id]/edit page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlatformAdminAuthForPermission.mockResolvedValue({
      status: 'authenticated',
      user: { email: 'admin@example.com', id: 'admin-1' },
    });
    mockCreateClient.mockResolvedValue(mockSupabase);
    mockSupabase.single.mockResolvedValue({
      data: {
        id: 'post-1',
        slug: 'launch-faster',
        status: 'draft',
        title: 'Launch Faster',
      },
      error: null,
    });
  });

  it('loads the post on the server and renders editor client in edit mode', async () => {
    render(
      await EditAdminBlogPostPage({
        params: Promise.resolve({ id: 'post-1' }),
      })
    );

    expect(screen.getByText('Blog editor client')).toBeInTheDocument();
    expect(mockBlogEditorClient).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'edit',
        postId: 'post-1',
      })
    );
    expect(mockSupabase.eq).toHaveBeenCalledWith('id', 'post-1');
    expect(mockGetPlatformAdminAuthForPermission).toHaveBeenCalledWith(
      'content.manage'
    );
  });

  it('calls notFound when post lookup fails', async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116' },
    });

    await expect(
      EditAdminBlogPostPage({
        params: Promise.resolve({ id: 'missing' }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockNotFound).toHaveBeenCalled();
  });

  it('throws a server error when lookup fails for non-404 reasons', async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: null,
      error: { code: '57014', message: 'statement timeout' },
    });

    await expect(
      EditAdminBlogPostPage({
        params: Promise.resolve({ id: 'post-1' }),
      })
    ).rejects.toThrow('Failed to load platform blog post');
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it('redirects unauthenticated users to login', async () => {
    mockGetPlatformAdminAuthForPermission.mockResolvedValueOnce({
      status: 'unauthenticated',
    });

    await expect(
      EditAdminBlogPostPage({
        params: Promise.resolve({ id: 'post-1' }),
      })
    ).rejects.toThrow('NEXT_REDIRECT:/login?redirect=%2Fadmin');
    expect(mockRedirect).toHaveBeenCalledWith('/login?redirect=%2Fadmin');
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('redirects non-content roles to dashboard', async () => {
    mockGetPlatformAdminAuthForPermission.mockResolvedValueOnce({
      status: 'forbidden',
    });

    await expect(
      EditAdminBlogPostPage({
        params: Promise.resolve({ id: 'post-1' }),
      })
    ).rejects.toThrow('NEXT_REDIRECT:/dashboard');
    expect(mockRedirect).toHaveBeenCalledWith('/dashboard');
    expect(mockGetPlatformAdminAuthForPermission).toHaveBeenCalledWith(
      'content.manage'
    );
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});
