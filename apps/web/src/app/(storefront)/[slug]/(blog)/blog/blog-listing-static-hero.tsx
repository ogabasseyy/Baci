import { BlogFeaturedStory } from '@/components/storefront/ogabassey/pages/blog-featured-story';
import { getBlogListingImageSrc } from '@/components/storefront/ogabassey/pages/blog-listing-image-src';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import { getCachedBlogListing } from '@/lib/cached-data';
import { buildStoreUrl } from '@/lib/store-url';
import type { BlogPostData } from '@/templates/registry';
import {
  getBlogListingHeroPost,
  preloadOgabasseyRootBlogListingHeroImage,
} from './blog-listing-hero-image-preload';

const OGABASSEY_BLOG_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
  year: 'numeric',
});

interface BlogListingStaticHeroProps {
  params: Promise<{ slug: string }>;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) {
    return dateString;
  }

  return OGABASSEY_BLOG_DATE_FORMATTER.format(date);
}

function toFeaturedStoryPost(
  post: {
    id?: string | number | null;
    title: string;
    slug: string;
    excerpt?: string | null;
    category?: string | null;
    author_name?: string | null;
    published_at?: string | null;
    featured_image_url?: string | null;
    reading_time_minutes?: number | null;
  },
  merchantName: string
): BlogPostData {
  return {
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
}

export async function BlogListingStaticHero({
  params,
}: BlogListingStaticHeroProps) {
  const { slug } = await params;
  const data = await getCachedBlogListing(slug);

  if (!data || data.merchant.template_id !== OGABASSEY_TEMPLATE_ID) {
    return null;
  }

  const heroPost = getBlogListingHeroPost(data.posts);
  if (!heroPost?.slug || !heroPost.title) {
    return null;
  }

  preloadOgabasseyRootBlogListingHeroImage({
    posts: data.posts,
    templateId: data.merchant.template_id,
  });

  const featuredPost = toFeaturedStoryPost(
    {
      id: heroPost.id ?? heroPost.slug,
      title: heroPost.title,
      slug: heroPost.slug,
      excerpt: heroPost.excerpt,
      category: heroPost.category,
      author_name: heroPost.author_name,
      published_at: heroPost.published_at,
      featured_image_url: heroPost.featured_image_url,
      reading_time_minutes: heroPost.reading_time_minutes,
    },
    data.merchant.business_name
  );

  return (
    <div className="bg-gray-50 px-4 pt-8 md:px-6 md:pt-12">
      <div className="mx-auto max-w-[1400px]">
        <BlogFeaturedStory
          basePath={buildStoreUrl(data.merchant)}
          featuredPost={featuredPost}
          imageSrc={getBlogListingImageSrc(featuredPost.featured_image_url)}
          publishedDateLabel={formatDate(featuredPost.published_at)}
        />
      </div>
    </div>
  );
}
