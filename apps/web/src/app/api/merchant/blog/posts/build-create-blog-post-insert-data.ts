import type { z } from 'zod';
import {
  calculateReadingTime,
  calculateWordCount,
  extractKeywords,
  generateExcerpt,
  generateSeoDescription,
} from '@/lib/blog-utils';
import type { createPostSchema } from '@/lib/validations/blog';

type CreatePostData = z.infer<typeof createPostSchema>;

export function buildCreateBlogPostInsertData(
  merchantId: string,
  postData: CreatePostData
) {
  const autoExcerpt = postData.excerpt || generateExcerpt(postData.content);
  const autoKeywords = postData.keywords?.length
    ? postData.keywords
    : extractKeywords(postData.title, postData.content);
  const scheduledPublishAt =
    postData.status === 'scheduled' ? (postData.published_at ?? null) : null;

  return {
    merchant_id: merchantId,
    title: postData.title,
    slug: postData.slug,
    content: postData.content,
    excerpt: autoExcerpt,
    featured_image_url: postData.featured_image_url,
    featured_image_width: postData.featured_image_width,
    featured_image_height: postData.featured_image_height,
    featured_image_variants: postData.featured_image_variants ?? {},
    featured_image_alt: postData.featured_image_alt,
    category: postData.category,
    tags: postData.tags || [],
    keywords: autoKeywords,
    author_name: postData.author_name,
    author_title: postData.author_title,
    author_image_url: postData.author_image_url,
    author_bio: postData.author_bio,
    status: postData.status || 'draft',
    seo_title: postData.seo_title || postData.title.substring(0, 70),
    seo_description:
      postData.seo_description || generateSeoDescription(postData.content),
    focus_keyword:
      postData.focus_keyword ||
      (autoKeywords.length > 0 ? autoKeywords[0] : undefined),
    word_count: calculateWordCount(postData.content),
    reading_time_minutes: calculateReadingTime(postData.content),
    published_at:
      postData.status === 'published'
        ? new Date().toISOString()
        : scheduledPublishAt,
    requested_publish_at: scheduledPublishAt,
  };
}
