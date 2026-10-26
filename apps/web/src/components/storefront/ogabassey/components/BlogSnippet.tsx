/**
 * BlogSnippet - Client Component
 *
 * Displays a related blog post on product pages.
 * Uses semantic matching via API to find the most relevant blog post.
 * Falls back to category-based matching if semantic search fails.
 */

'use client';

import { ArrowRight, BookOpen } from 'lucide-react';
import Link from 'next/link';
import type React from 'react';
import { useEffect, useState } from 'react';
import { CdnFormatImage } from '@/components/storefront/cdn-format-image';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import {
  BLOG_POST_PRODUCT_LINKS_SELECT,
  type BlogPostProductLinkRow,
  normalizeBlogPostProductLink,
} from '@/lib/blog-post-product-links';
import { waitForLcpWindowEnd } from '@/lib/posthog/wait-for-lcp';

interface BlogSnippetProps {
  category: string;
  productId?: string;
  merchantId?: string;
}

interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  featured_image_url: string | null;
  category: string | null;
  reading_time_minutes: number | null;
}

export const BlogSnippet: React.FC<BlogSnippetProps> = ({
  category,
  productId,
  merchantId,
}) => {
  const merchantContext = useMerchantSafe();
  const basePath = merchantContext?.basePath || '';
  const [post, setPost] = useState<BlogPost | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchRelatedBlog() {
      if (!merchantId) {
        return;
      }

      try {
        // This recommendation is below the PDP: do not compete with its hero
        // for the SDK, network or main thread. Reuse the bounded LCP/interaction
        // signal already used by the storefront's deferred UI.
        await waitForLcpWindowEnd();
        if (cancelled) return;
        const { createClient } = await import('@/lib/supabase/client');
        if (cancelled) return;
        const supabase = createClient();
        // Prefer explicit product-post links authored by the content agent.
        if (productId) {
          const { data: explicitLinks, error: explicitLinksError } =
            await supabase
              .from('blog_post_products')
              .select(BLOG_POST_PRODUCT_LINKS_SELECT)
              .eq('merchant_id', merchantId)
              .eq('product_id', productId)
              .eq('blog_posts.status', 'published')
              .not('blog_posts.published_at', 'is', null)
              .order('created_at', { ascending: false })
              .limit(1);

          if (explicitLinksError) {
            console.error(
              'Error fetching explicit product blog link:',
              explicitLinksError
            );
          }

          const explicitPost = (explicitLinks ?? [])
            .map((row) =>
              normalizeBlogPostProductLink(row as BlogPostProductLinkRow)
            )
            .find((candidate) => candidate !== null);

          if (explicitPost) {
            if (!cancelled) setPost(explicitPost);
            return;
          }

          // Get product embedding
          const { data: product, error: productError } = await supabase
            .from('products')
            .select('content_embedding')
            .eq('id', productId)
            .maybeSingle();

          if (productError) {
            console.error(
              'Error fetching product embedding for blog snippet:',
              productError
            );
          }

          if (!productError && product?.content_embedding) {
            // Use semantic matching RPC
            const { data: matches, error: matchError } = await supabase.rpc(
              'match_blog_to_product',
              {
                product_embedding: product.content_embedding,
                merchant_id_filter: merchantId,
                match_threshold: 0.5,
                match_count: 1,
              }
            );

            if (matchError) {
              console.error('Error matching blog post to product:', matchError);
            }

            if (!matchError && matches && matches.length > 0) {
              if (!cancelled) setPost(matches[0]);
              return;
            }
          }
        }

        // Fallback: Search by category keyword in title
        if (category) {
          const searchTerm = category.split(' ')[0]; // Get first word
          const { data: categoryPosts, error: categoryPostsError } =
            await supabase
              .from('blog_posts')
              .select(
                'id, title, slug, excerpt, featured_image_url, category, reading_time_minutes'
              )
              .eq('merchant_id', merchantId)
              .eq('status', 'published')
              .not('published_at', 'is', null)
              .ilike('title', `%${searchTerm}%`)
              .order('published_at', { ascending: false })
              .limit(1);

          if (categoryPostsError) {
            console.error(
              'Error fetching category blog snippet:',
              categoryPostsError
            );
          }

          if (categoryPosts && categoryPosts.length > 0) {
            if (!cancelled) setPost(categoryPosts[0]);
            return;
          }
        }

        // Final fallback: Get most recent post
        const { data: recentPosts, error: recentPostsError } = await supabase
          .from('blog_posts')
          .select(
            'id, title, slug, excerpt, featured_image_url, category, reading_time_minutes'
          )
          .eq('merchant_id', merchantId)
          .eq('status', 'published')
          .not('published_at', 'is', null)
          .order('published_at', { ascending: false })
          .limit(1);

        if (recentPostsError) {
          console.error(
            'Error fetching recent blog snippet:',
            recentPostsError
          );
        }

        if (recentPosts && recentPosts.length > 0) {
          if (!cancelled) setPost(recentPosts[0]);
        }
      } catch (error) {
        console.error('Error fetching related blog:', error);
      }
    }

    fetchRelatedBlog();
    return () => {
      cancelled = true;
    };
  }, [productId, merchantId, category]);

  // Don't render until a post is found (output is null while loading either way)
  if (!post) {
    return null;
  }

  const readTime = post.reading_time_minutes
    ? `${post.reading_time_minutes} min read`
    : '4 min read';

  return (
    <aside aria-label="Related Articles" className="mt-16 mb-8">
      <div className="flex items-center gap-2 mb-6">
        <BookOpen className="text-red-600" size={20} />
        <h3 className="text-xl font-bold text-gray-900">From the Blog</h3>
      </div>

      <Link href={`${basePath}/blog/${post.slug}` as any} className="block">
        <div className="group relative overflow-hidden rounded-2xl bg-white border border-gray-100 shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="flex flex-col md:flex-row">
            {/* Image Section */}
            <div className="md:w-1/3 h-48 md:h-auto overflow-hidden relative">
              <CdnFormatImage
                src={post.featured_image_url || '/placeholder.png'}
                alt={post.title}
                fill
                className="object-cover transition-transform duration-700 group-hover:scale-110"
                sizes="(max-width: 768px) 100vw, 33vw"
              />
              <div className="absolute inset-0 bg-black/10 group-hover:bg-transparent transition-colors" />
              {(post.category || category) && (
                <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-sm text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider text-gray-800">
                  {post.category || category}
                </div>
              )}
            </div>

            {/* Content Section */}
            <div className="p-6 md:p-8 flex-1 flex flex-col justify-center">
              <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
                <span>Ogabassey Editor</span>
                <span>•</span>
                <span>{readTime}</span>
              </div>
              <h4 className="text-2xl font-bold text-gray-900 mb-3 group-hover:text-red-600 transition-colors line-clamp-2">
                {post.title}
              </h4>
              {post.excerpt && (
                <p className="text-gray-600 mb-6 line-clamp-2 md:line-clamp-none">
                  {post.excerpt}
                </p>
              )}

              <span className="inline-flex items-center gap-2 text-sm font-bold text-red-600 hover:text-red-700 uppercase tracking-wider">
                Read Full Article{' '}
                <ArrowRight
                  size={16}
                  className="group-hover:translate-x-1 transition-transform"
                />
              </span>
            </div>
          </div>
        </div>
      </Link>
    </aside>
  );
};
