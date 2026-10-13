import { redirect } from 'next/navigation';
import { BlogListClient } from '@/app/admin/blog/blog-list-client';
import { PLATFORM_BLOG_PAGE_SIZE } from '@/app/admin/blog/blog-pagination';
import type { PlatformAdminBlogPostSummary } from '@/app/admin/blog/blog-types';
import { getPlatformAdminAuthForPermission } from '@/lib/platform-admin-auth';
import { createClient } from '@/lib/supabase/server';

export default async function AdminBlogPage() {
  const auth = await getPlatformAdminAuthForPermission('content.manage');
  if (auth.status === 'unauthenticated') {
    redirect('/login?redirect=%2Fadmin');
  }

  if (auth.status === 'forbidden') {
    redirect('/dashboard');
  }

  let initialError: string | null = null;
  let initialHasMore = false;
  let initialPosts: PlatformAdminBlogPostSummary[] = [];

  try {
    const supabase = await createClient();
    const { count, data, error } = await supabase
      .from('blog_posts')
      .select(
        'id, title, slug, excerpt, featured_image_url, category, status, author_name, reading_time_minutes, view_count, created_at, updated_at, published_at',
        { count: 'exact' }
      )
      .eq('is_platform_post', true)
      .is('merchant_id', null)
      .order('created_at', { ascending: false })
      .range(0, PLATFORM_BLOG_PAGE_SIZE - 1);

    if (error) {
      console.error('Failed to load platform blog posts:', error);
      initialError = 'Failed to load platform blog posts';
    } else {
      initialPosts = (data ?? []) as PlatformAdminBlogPostSummary[];
      const totalPosts = count ?? initialPosts.length;
      initialHasMore = totalPosts > initialPosts.length;
    }
  } catch (error) {
    console.error('Platform blog admin page load error:', error);
    initialError = 'Failed to load platform blog posts';
  }

  return (
    <BlogListClient
      initialError={initialError}
      initialHasMore={initialHasMore}
      initialPosts={initialPosts}
      pageSize={PLATFORM_BLOG_PAGE_SIZE}
    />
  );
}
