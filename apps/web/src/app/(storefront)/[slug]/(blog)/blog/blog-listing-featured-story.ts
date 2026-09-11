import type { BlogPostData } from '@/templates/registry';

const OGABASSEY_BLOG_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
  year: 'numeric',
});

export interface BlogListingFeaturedStoryPost {
  author_name?: string | null;
  category?: string | null;
  excerpt?: string | null;
  featured_image_url?: string | null;
  id?: string | number | null;
  published_at?: string | null;
  reading_time_minutes?: number | null;
  slug: string;
  title: string;
}

function formatPublishedDate(dateString: string): string {
  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) {
    return dateString;
  }

  return OGABASSEY_BLOG_DATE_FORMATTER.format(date);
}

export function buildBlogListingFeaturedStory(
  post: BlogListingFeaturedStoryPost,
  merchantName: string
): {
  featuredPost: BlogPostData;
  publishedDateLabel: string;
} {
  const featuredPost: BlogPostData = {
    id: post.id ?? post.slug,
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt || '',
    category: post.category || '',
    author_name: post.author_name || merchantName,
    published_at: post.published_at || '',
    featured_image_url: post.featured_image_url || '',
    reading_time_minutes: post.reading_time_minutes || 3,
  };

  return {
    featuredPost,
    publishedDateLabel: formatPublishedDate(featuredPost.published_at),
  };
}
