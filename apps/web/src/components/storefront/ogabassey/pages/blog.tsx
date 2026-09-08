import { ArrowRight, Battery, Calendar, Search, User } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { buildBlogCategoryHref } from '@/app/(storefront)/[slug]/(blog)/blog/blog-category-routing';
import {
  BLOG_HERO_IMAGE_QUALITY,
  BLOG_LISTING_CARD_IMAGE_SIZES,
} from '@/components/storefront/ogabassey/config/blog-media';
import { asRoute, joinRouteBasePath } from '@/lib/routes';
import type { BlogPostData, TemplateBlogPageProps } from '@/templates/registry';
import { AdUnit } from './ad-unit';
import { BlogFeaturedStory } from './blog-featured-story';
import { getBlogListingImageSrc } from './blog-listing-image-src';

export type BlogPost = BlogPostData;

interface OgabasseyBlogProps extends TemplateBlogPageProps {
  merchantSlug?: string;
}

const OGABASSEY_BLOG_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
  year: 'numeric',
});

const OGABASSEY_BLOG_CATEGORIES = [
  'All',
  'Mobile Gadgets',
  'Laptops',
  'Tips and Tricks',
  'Reviews',
  'Tech News',
  'How to Guides',
  'Buying Guides',
  'Smartphone Comparisons',
  'Product Guides',
] as const;


function formatDate(dateString: string): string {
  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) {
    return dateString;
  }

  return OGABASSEY_BLOG_DATE_FORMATTER.format(date);
}

function getCategoryLabels(
  categories: OgabasseyBlogProps['categories']
): string[] {
  const labels = categories?.map((category) => category.name).filter(Boolean) ?? [];
  return Array.from(new Set([...OGABASSEY_BLOG_CATEGORIES, ...labels]));
}

function blogHref(basePath: string, path = ''): string {
  return joinRouteBasePath(basePath, `/blog${path}`);
}

// Emit the canonical /blog/category/<slug> path (via the shared routing
// helper) instead of the legacy ?category= query form, which 308s to it —
// Semrush flagged ~1,700 internal redirect links from these chips alone.
//
// Clean paths are emitted ONLY for labels backed by published posts: the
// clean category route validates against get_public_blog_categories and
// notFound()s unknown slugs, so a hard-coded chip with no posts (e.g.
// Mobile Gadgets on a store without them) keeps the ?category= query form,
// which the listing renders as an empty filter (200, no redirect). basePath
// is normalized through joinRouteBasePath first because it can arrive as an
// absolute store URL, a bare merchant slug, or empty.
function blogCategoryHref(
  basePath: string,
  category: string,
  publishedCategories: string[]
): string {
  if (category === 'All') {
    return blogHref(basePath);
  }

  if (!publishedCategories.includes(category)) {
    return blogHref(basePath, `?category=${encodeURIComponent(category)}`);
  }

  return buildBlogCategoryHref(
    joinRouteBasePath(basePath, '/'),
    category,
    publishedCategories
  );
}

export function OgabasseyV2Blog({
  posts = [],
  storeSlug,
  merchantSlug,
  categories: propCategories,
  searchQuery,
  category,
  hideFeaturedStory = false,
}: OgabasseyBlogProps) {
  const basePath = storeSlug || merchantSlug || '';
  const activeCategory = category || 'All';
  const isSearching = Boolean(searchQuery);
  const categories = getCategoryLabels(propCategories);
  const publishedCategories = (propCategories ?? [])
    .map((entry) => entry.name)
    .filter(Boolean);
  const filteredPosts =
    activeCategory === 'All'
      ? posts
      : posts.filter((post) => post.category === activeCategory);
  const featuredPost = posts.find((post) => post.featured) || posts[0];

  if (posts.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 pb-20 pt-4">
        <div className="mb-8 border-gray-100 border-b bg-white pt-8 pb-10">
          <div className="mx-auto max-w-[1400px] px-4 text-center md:px-6">
            <h1 className="mb-4 font-extrabold text-3xl text-gray-900 tracking-tight md:text-5xl">
              The Ogabassey Blog
            </h1>
            <p className="text-gray-500 text-lg">No posts found.</p>
          </div>
        </div>
        <div className="mx-auto max-w-[1400px] px-4 md:px-6">
          <div className="rounded-2xl border border-gray-100 bg-white p-12 text-center">
            <h2 className="mb-4 font-bold text-2xl text-gray-900">No posts yet</h2>
            <p className="mb-6 text-gray-500">
              Check back soon for expert reviews, tips, and guides!
            </p>
            <Link
              href={asRoute(joinRouteBasePath(basePath, '/'))}
              className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-6 py-3 font-bold text-white transition-colors hover:bg-red-700"
            >
              Back to Store <ArrowRight size={20} />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pt-4 pb-20">
      <div className="mx-auto max-w-[1400px] px-4 pt-8 md:px-6 md:pt-12">
        {!hideFeaturedStory &&
          !isSearching &&
          activeCategory === 'All' &&
          featuredPost && (
          <BlogFeaturedStory
            basePath={basePath}
            featuredPost={featuredPost}
            imageSrc={getBlogListingImageSrc(featuredPost.featured_image_url)}
            publishedDateLabel={formatDate(featuredPost.published_at)}
          />
        )}

        <div className="mb-12 flex flex-col items-center justify-center text-center">
          {isSearching ? (
            <div className="w-full max-w-3xl text-left">
              <div className="mb-4 flex items-center gap-2 font-medium text-red-600 text-sm uppercase tracking-wider">
                <Search size={16} /> Search Results
              </div>
              <h1 className="mb-6 font-black text-4xl text-gray-900 leading-none tracking-tight md:text-6xl">
                For &quot;{searchQuery}&quot;
              </h1>
              <Link
                href={asRoute(blogHref(basePath))}
                className="inline-flex items-center gap-2 border-gray-300 border-b pb-0.5 text-gray-500 transition-colors hover:border-gray-900 hover:text-gray-900"
              >
                <ArrowRight size={16} className="rotate-180" />
                Clear search
              </Link>
            </div>
          ) : (
            <div className="w-full text-center">
              <h1 className="mb-4 font-black text-4xl text-gray-900 leading-[0.9] tracking-tight md:text-7xl">
                The Ogabassey Blog
              </h1>
              <p className="mx-auto w-full text-gray-500 text-lg leading-relaxed md:text-xl">
                Tech reviews, sustainability guides, and the latest from the world of gadgets.
              </p>
            </div>
          )}
        </div>

        <div className="sticky top-20 z-30 -mx-4 mb-10 border-gray-200/50 border-b bg-gray-50/95 px-4 pt-2 pb-6 backdrop-blur-xs md:mx-0 md:px-0">
          <div className="hide-scrollbar flex items-center gap-2 overflow-x-auto md:gap-3">
            <span className="mr-2 shrink-0 font-bold text-gray-400 text-xs uppercase tracking-widest">
              Filter By:
            </span>
            {categories.map((cat) => (
              <Link
                key={cat}
                href={asRoute(blogCategoryHref(basePath, cat, publishedCategories))}
                className={`whitespace-nowrap rounded-lg border px-4 py-2 font-bold text-sm transition-all ${
                  activeCategory === cat
                    ? 'scale-105 transform border-gray-900 bg-gray-900 text-white shadow-md'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400 hover:bg-gray-100'
                }`}
                aria-current={activeCategory === cat ? 'page' : undefined}
              >
                {cat}
              </Link>
            ))}
          </div>
        </div>

        <div className="mb-12 grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
          {filteredPosts
            .filter((post) => post.id !== featuredPost?.id || activeCategory !== 'All')
            .map((post) => (
              <Link key={post.id} href={asRoute(blogHref(basePath, `/${post.slug}`))} className="block h-full">
                <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
                  <div className="relative h-64 overflow-hidden">
                    <Image
                      src={getBlogListingImageSrc(post.featured_image_url)}
                      alt={post.title}
                      className="object-cover transition-transform duration-700 group-hover:scale-110"
                      fill
                      sizes={BLOG_LISTING_CARD_IMAGE_SIZES}
                      loading="lazy"
                      fetchPriority="low"
                      quality={BLOG_HERO_IMAGE_QUALITY}
                    />
                    {post.category && (
                      <div className="absolute top-4 left-4 rounded border border-gray-100 bg-white/95 px-3 py-1 font-black text-gray-900 text-xs uppercase tracking-wider shadow-sm backdrop-blur-md">
                        {post.category}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col p-6">
                    <div className="mb-4 flex items-center gap-4 font-bold text-gray-400 text-xs uppercase tracking-wider">
                      <span className="flex items-center gap-1">
                        <Calendar size={12} className="text-red-500" />
                        <time dateTime={post.published_at}>{formatDate(post.published_at)}</time>
                      </span>
                      <span className="size-1 rounded-full bg-gray-300" />
                      <span>{post.reading_time_minutes || 3} MIN READ</span>
                    </div>
                    <h3 className="mb-3 font-black text-gray-900 text-xl leading-tight line-clamp-2 transition-colors group-hover:text-red-600 md:text-2xl">
                      {post.title}
                    </h3>
                    <p className="mb-6 flex-1 text-gray-500 text-sm leading-relaxed line-clamp-3 md:text-base">
                      {post.excerpt}
                    </p>
                    <div className="mt-auto flex items-center justify-between border-gray-50 border-t pt-6">
                      <div className="flex items-center gap-2">
                        <div className="flex size-8 items-center justify-center rounded-full border border-gray-200 bg-gray-100 text-gray-500">
                          <User size={14} />
                        </div>
                        <span className="font-bold text-gray-700 text-xs">
                          {post.author_name || 'Ogabassey Team'}
                        </span>
                      </div>
                      <span className="text-red-600 transition-transform group-hover:translate-x-1 group-hover:text-red-700">
                        <ArrowRight size={20} />
                      </span>
                    </div>
                  </div>
                </article>
              </Link>
            ))}
        </div>

        <div className="mb-16 flex flex-col items-center gap-8 rounded-3xl border border-green-100 bg-linear-to-br from-green-50 to-emerald-50 p-8 shadow-lg md:flex-row md:p-12">
          <div className="shrink-0 rotate-3 transform rounded-2xl bg-white p-6 text-green-600 shadow-md">
            <Battery size={40} />
          </div>
          <div className="flex-1 text-center md:text-left">
            <h3 className="mb-3 font-black text-2xl text-gray-900">Extend Your Tech&apos;s Life</h3>
            <p className="text-gray-600 text-lg">
              Keeping your phone battery between 20% and 80% can double its lifespan. Read more tips in our{' '}
              <span className="font-bold text-green-700">Tips and Tricks</span> section.
            </p>
          </div>
          <Link
            href={asRoute(
              blogCategoryHref(basePath, 'Tips and Tricks', publishedCategories)
            )}
            className="rounded-xl bg-green-600 px-8 py-4 font-bold text-white shadow-xl transition-all hover:-translate-y-1 hover:bg-green-700 hover:shadow-2xl active:scale-95"
          >
            View Green Tips
          </Link>
        </div>

        <AdUnit placementKey="FOOTER_BANNER" />
      </div>
    </div>
  );
}
