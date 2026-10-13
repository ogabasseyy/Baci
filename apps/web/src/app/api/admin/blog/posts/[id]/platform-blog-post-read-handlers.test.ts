import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  revalidatePlatformBlog: vi.fn(),
}));

vi.mock('@/lib/cache-revalidation', () => ({
  revalidatePlatformBlog: mocks.revalidatePlatformBlog,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

import {
  deletePlatformBlogPost,
  getPlatformBlogPost,
} from './platform-blog-post-read-handlers';

function params(id = 'post-1') {
  return { params: Promise.resolve({ id }) };
}

function createSupabase(single: ReturnType<typeof vi.fn>) {
  const query = {
    delete: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    select: vi.fn(),
    single,
  };
  query.delete.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.is.mockReturnValue(query);
  query.select.mockReturnValue(query);
  return { from: vi.fn(() => query), query };
}

describe('platform blog read handlers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects invalid post route parameters before querying Supabase', async () => {
    const response = await getPlatformBlogPost(params(''));

    expect(response.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('reads only a platform-owned post and reports a missing post', async () => {
    const supabase = createSupabase(
      vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } })
    );
    mocks.createClient.mockResolvedValue(supabase);

    const response = await getPlatformBlogPost(params());

    expect(response.status).toBe(404);
    expect(supabase.query.eq).toHaveBeenCalledWith('is_platform_post', true);
    expect(supabase.query.is).toHaveBeenCalledWith('merchant_id', null);
  });

  it('revalidates a deleted platform post only after the scoped delete succeeds', async () => {
    const supabase = createSupabase(
      vi
        .fn()
        .mockResolvedValueOnce({ data: { slug: 'launch-faster' }, error: null })
        .mockResolvedValueOnce({ error: null })
    );
    mocks.createClient.mockResolvedValue(supabase);

    const response = await deletePlatformBlogPost(params());

    expect(response.status).toBe(200);
    expect(mocks.revalidatePlatformBlog).toHaveBeenCalledWith('launch-faster');
    expect(supabase.query.eq).toHaveBeenCalledWith('is_platform_post', true);
    expect(supabase.query.is).toHaveBeenCalledWith('merchant_id', null);
  });
});
