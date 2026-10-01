import { notFound, redirect } from 'next/navigation';
import { BlogEditorClient } from '@/app/admin/blog/blog-editor-client';
import type { PlatformAdminBlogPostDetail } from '@/app/admin/blog/blog-types';
import { getPlatformAdminAuthForPermission } from '@/lib/platform-admin-auth';
import { createClient } from '@/lib/supabase/server';

type EditAdminBlogPostPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function EditAdminBlogPostPage({
  params,
}: EditAdminBlogPostPageProps) {
  const auth = await getPlatformAdminAuthForPermission('content.manage');
  if (auth.status === 'unauthenticated') {
    redirect('/login?redirect=%2Fadmin');
  }

  if (auth.status === 'forbidden') {
    redirect('/dashboard');
  }

  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('blog_posts')
    .select(
      'id, title, slug, content, excerpt, featured_image_url, featured_image_alt, featured_image_width, featured_image_height, featured_image_variants, category, tags, keywords, author_name, author_title, author_image_url, author_bio, status, seo_title, seo_description, focus_keyword, word_count, reading_time_minutes, view_count, created_at, updated_at, published_at'
    )
    .eq('id', id)
    .eq('is_platform_post', true)
    .is('merchant_id', null)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      notFound();
    }
    console.error('Failed to load platform blog post for edit:', error);
    throw new Error('Failed to load platform blog post');
  }

  if (!data) {
    notFound();
  }

  return (
    <BlogEditorClient
      mode="edit"
      postId={id}
      initialPost={data as PlatformAdminBlogPostDetail}
    />
  );
}
