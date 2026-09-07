import type { Metadata } from 'next';
import { unstable_rethrow } from 'next/navigation';
import { Suspense } from 'react';
import { getBlogPostSocialImage } from '@/lib/blog-post-social-image';
import { getRequestScopedBlogPost } from '@/lib/cached-data';
import { generateMetaDescription } from '@/lib/seo-utils';
import { buildStoreUrl } from '@/lib/store-url';
import { buildStorefrontMetadataTitle } from '@/lib/storefront-metadata-title';
import { evaluateStorefrontSlugSafety } from '@/lib/storefront-slug-safety';
import { BlogPostBodyFallback } from './BlogPostBodyFallback';
import { BlogPostPageFallback } from './BlogPostPageFallback';
import {
  buildCanonicalBlogPostUrl,
  getBlogPostTextPreview,
} from './blog-post-content';
import { preloadOgabasseyBlogPostHeroResources } from './blog-post-hero-resource-hints';
import { resolveBlogPostHeroShell } from './blog-post-hero-shell-data';
import BlogPostPageContent from './blog-post-page-content';
import { BlogPostShell } from './blog-post-shell';
import { resolveBlogPostStaticParams } from './blog-post-static-params';

interface PageProps {
  params: Promise<{ slug: string; postSlug: string }>;
}

// Missing, retired, and draft-only posts share one cacheable noindex stub.
// The real HTTP 404/308 for those slugs is owned by the proxy blog-post
// preflight, which decides status BEFORE this route streams — metadata must
// stay free of request APIs (connection()/draftMode()) or the whole route
// loses its static shell (NEXT_STATIC_GEN_BAILOUT on every request).
const BLOG_POST_NOINDEX_METADATA: Metadata = {
  title: 'Blog Post',
  robots: { index: false, follow: false },
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug, postSlug } = await params;

  // Over-long / repeatedly-encoded bot slugs can never match a post; bail
  // before the `'use cache'` getCachedBlogPost lookup runs with an unbounded
  // key (its cache key + tag both include the raw postSlug).
  if (!evaluateStorefrontSlugSafety(postSlug).safe) {
    return BLOG_POST_NOINDEX_METADATA;
  }

  // Cached-only lookup keeps generateMetadata prerenderable. Metadata resolves
  // outside every Suspense boundary, and with htmlLimitedBots configured a
  // dynamic API here forces the whole document to request time — the exact
  // static-shell bailout this route shipped with connection() at the top.
  // Request-scoped (React cache()) so the identical lookup the hero-shell and
  // streamed body resolvers make below reuses this Promise instead of issuing
  // a second Supabase round-trip.
  let data: Awaited<ReturnType<typeof getRequestScopedBlogPost>> = null;
  try {
    data = await getRequestScopedBlogPost(slug, postSlug, false);
  } catch (error) {
    unstable_rethrow(error);
    console.error('Error fetching cached public blog metadata', {
      slug,
      postSlug,
      error,
    });
  }

  if (!data) {
    return BLOG_POST_NOINDEX_METADATA;
  }

  const { merchant, post } = data;
  const title = post.seo_title || post.title || 'Blog Post';
  const { metadataTitle, title: metadataTitleText } =
    buildStorefrontMetadataTitle({
      title,
      suffix: merchant.business_name,
      fallback: 'Blog Post',
      // Google may truncate a title link to device width, but does not impose
      // a fixed character limit. Keep the full normalized blog title instead
      // of adding a literal ellipsis before the merchant suffix.
      maxLength: Number.POSITIVE_INFINITY,
    });
  const description = generateMetaDescription(
    post.seo_description ||
      post.excerpt ||
      getBlogPostTextPreview(post.content),
    160,
    {
      minLength: 110,
      fallback: `Read ${post.title || 'this article'} from ${merchant.business_name} for buying guidance, product context, and local shopping insights.`,
    }
  );

  const url = buildCanonicalBlogPostUrl(merchant, post.slug);
  const baseUrl = buildStoreUrl(merchant);
  const socialImage = getBlogPostSocialImage(
    baseUrl,
    post.slug,
    post.featured_image_url,
    post.featured_image_variants,
    post.featured_image_width,
    post.featured_image_height
  );
  const socialImageAlt = post.title
    ? `${post.title} — ${merchant.business_name}`
    : title;

  return {
    title: metadataTitle,
    description,
    keywords: post.keywords?.join(', '),
    authors: [{ name: post.author_name }],
    openGraph: {
      title: metadataTitleText,
      description,
      type: 'article',
      url,
      publishedTime: post.published_at,
      modifiedTime: post.updated_at,
      authors: [post.author_name],
      tags: post.tags,
      images: [
        {
          url: socialImage.url,
          alt: socialImageAlt,
          ...(socialImage.width ? { width: socialImage.width } : {}),
          ...(socialImage.height ? { height: socialImage.height } : {}),
          ...(socialImage.type ? { type: socialImage.type } : {}),
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: metadataTitleText,
      description,
      images: [socialImage.url],
    },
    alternates: {
      canonical: url,
    },
    robots: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  };
}

// Prerender OgaBassey's newest published posts per static blog tenant so the
// above-fold hero ships inside the PPR shell (LCP). Non-listed posts keep
// rendering on demand (`dynamicParams` cannot be set with cacheComponents).
export function generateStaticParams(): Promise<
  Array<{ slug: string; postSlug: string }>
> {
  return resolveBlogPostStaticParams();
}

export default async function BlogPostPage({ params }: PageProps) {
  const { slug, postSlug } = await params;

  // Cached-only hero lookup — the same getRequestScopedBlogPost() lookup
  // generateMetadata awaits (deduped via React cache(), so this reuses that
  // Promise instead of a second Supabase round-trip), and static-shell-safe
  // for exactly that reason: it has no request APIs. Hoisting the hero +
  // header into the static shell here (outside the data Suspense) puts the
  // LCP image in the prerendered shell.
  //
  // The forbidden regression is a *request* API at this root (connection(),
  // draftMode(), cookies(), headers(), searchParams) — that forces the route
  // dynamic and reintroduces the per-request NEXT_STATIC_GEN_BAILOUT (PR #2882).
  // Hard 404/308 stays in the proxy blog-post preflight; draft/not-found/
  // redirect handling stays in the streamed BlogPostPageContent subtree.
  const heroShell = await resolveBlogPostHeroShell(slug, postSlug);

  if (heroShell) {
    preloadOgabasseyBlogPostHeroResources(heroShell.hero.src);

    return (
      <BlogPostShell
        blogHref={heroShell.blogHref}
        header={heroShell.header}
        hero={heroShell.hero}
      >
        <Suspense fallback={<BlogPostBodyFallback />}>
          <BlogPostPageContent params={params} heroHoisted />
        </Suspense>
      </BlogPostShell>
    );
  }

  // Missing / draft-only / retired / imageless posts keep the exact prior
  // full-Suspense behavior so draft preview and the proxy-404 contract are
  // unchanged.
  return (
    <Suspense fallback={<BlogPostPageFallback />}>
      <BlogPostPageContent params={params} />
    </Suspense>
  );
}
