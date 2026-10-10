import type { SupabaseClient } from '@supabase/supabase-js';

type ExistingBlogPost = {
  author_image_url: string | null;
  category: string | null;
  content: string;
  excerpt: string | null;
  featured_image_height: number | null;
  featured_image_url: string | null;
  featured_image_variants: Record<string, unknown> | null;
  featured_image_width: number | null;
  id: string;
  published_at: string | null;
  slug: string;
  status: string;
  title: string;
};

export async function loadBlogPostForUpdate({
  merchantId,
  postId,
  supabase,
}: {
  merchantId: string;
  postId: string;
  supabase: SupabaseClient;
}): Promise<
  | { kind: 'found'; post: ExistingBlogPost }
  | { kind: 'not-found' }
  | { kind: 'error' }
> {
  const { data, error } = await supabase
    .from('blog_posts')
    .select(
      'id, slug, status, content, title, excerpt, category, published_at, author_image_url, featured_image_url, featured_image_width, featured_image_height, featured_image_variants'
    )
    .eq('id', postId)
    .eq('merchant_id', merchantId)
    .single();
  if (error?.code === 'PGRST116') return { kind: 'not-found' };
  if (error) {
    console.error('Failed to load blog post for update:', {
      merchantId,
      postId,
      error,
    });
    return { kind: 'error' };
  }
  if (!data) return { kind: 'not-found' };

  return { kind: 'found', post: data as ExistingBlogPost };
}
