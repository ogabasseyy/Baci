import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  blogPostRouteContext,
  blogPostSupabaseMock,
  getBlogPostRouteMocks,
  resetBlogPostRouteMocks,
} from './route.test-helpers';

const blogPostRouteMocks = getBlogPostRouteMocks();
const { DELETE, GET } = await import('./route');

describe('GET /api/admin/blog/posts/[id]', () => {
  beforeEach(resetBlogPostRouteMocks);

  it('returns 401 for unauthenticated users', async () => {
    blogPostRouteMocks.getPlatformAdminAuthForPermission.mockResolvedValueOnce({
      status: 'unauthenticated',
    });

    const response = await GET(
      new NextRequest('http://localhost/api/admin/blog/posts/post-1'),
      blogPostRouteContext()
    );

    expect(response.status).toBe(401);
  });

  it('denies a lower-privilege platform admin without content access', async () => {
    blogPostRouteMocks.getPlatformAdminAuthForPermission.mockResolvedValueOnce({
      status: 'forbidden',
    });

    const response = await GET(
      new NextRequest('http://localhost/api/admin/blog/posts/post-1'),
      blogPostRouteContext()
    );

    expect(response.status).toBe(403);
    expect(
      blogPostRouteMocks.getPlatformAdminAuthForPermission
    ).toHaveBeenCalledWith('content.manage');
  });

  it('fetches platform post by id and tenant-null scope', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/admin/blog/posts/post-1'),
      blogPostRouteContext()
    );

    expect(response.status).toBe(200);
    expect(blogPostSupabaseMock.eq).toHaveBeenCalledWith('id', 'post-1');
    expect(blogPostSupabaseMock.eq).toHaveBeenCalledWith(
      'is_platform_post',
      true
    );
    expect(blogPostSupabaseMock.is).toHaveBeenCalledWith('merchant_id', null);
  });
});

describe('DELETE /api/admin/blog/posts/[id]', () => {
  beforeEach(resetBlogPostRouteMocks);

  it('deletes platform post and revalidates using existing slug', async () => {
    const response = await DELETE(
      new NextRequest('http://localhost/api/admin/blog/posts/post-1', {
        method: 'DELETE',
      }),
      blogPostRouteContext()
    );

    expect(response.status).toBe(200);
    expect(blogPostSupabaseMock.delete).toHaveBeenCalled();
    expect(blogPostRouteMocks.revalidatePlatformBlog).toHaveBeenCalledWith(
      'launch-faster'
    );
  });
});
