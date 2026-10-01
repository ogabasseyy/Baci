import { AlertTriangle } from 'lucide-react';
import { draftMode, headers } from 'next/headers';
import Link from 'next/link';
import { permanentRedirect } from 'next/navigation';
import { Suspense } from 'react';
import { JsonLd } from '@/components/seo/json-ld';
import { InformationalClusterPanel } from '@/components/storefront/ogabassey/seo/informational-cluster-panel';
import { Button } from '@/components/ui/button';
import { hasBlogAuthorPage } from '@/lib/blog-authors';
import { getBlogPostRedirect } from '@/lib/blog-post-redirects';
import { getRequestLocale } from '@/lib/request-locale';
import { asRoute } from '@/lib/routes';
import { generateSlug } from '@/lib/seo-utils';
import { buildStoreUrl } from '@/lib/store-url';
import { buildInformationalClusterModel } from '@/lib/storefront-content/build-informational-cluster-model';
import { evaluateStorefrontSlugSafety } from '@/lib/storefront-slug-safety';
import { isDomainIdentifier } from '@/lib/validation';
import { StorefrontRouteNotFoundContent } from '../../../storefront-route-not-found-content';
import { getBlogStorefrontPathPrefix } from '../blog-storefront-path-prefix';
import { BlogPostBody } from './BlogPostBody';
import { BlogPostBodyFallback } from './BlogPostBodyFallback';
import { buildCanonicalBlogPostUrl } from './blog-post-content';
import { BlogPostShell } from './blog-post-shell';
import { buildBlogPostStructuredData } from './blog-post-structured-data';
import { getResolvedBlogPost } from './get-resolved-blog-post';
import { ViewCounter } from './view-counter';

interface BlogPostPageContentProps {
  params: Promise<{ slug: string; postSlug: string }>;
  /**
   * When true, the page root already rendered the hero + header + page chrome
   * from the cached post in the static shell (`BlogPostShell`), so this subtree
   * streams only the article body region. When false (default), this component
   * owns the full `BlogPostShell` render.
   */
  heroHoisted?: boolean;
}

// Blog metadata keeps missing posts noindex; this stable body covers both the
// unsafe-slug gate and render-time misses without throwing inside an
// already-streaming route.
function renderBlogPostNotFound(blogHref: string) {
  return (
    <StorefrontRouteNotFoundContent
      backHref={asRoute(blogHref)}
      backLabel="Back to blog"
      message="This article is unavailable or has moved."
      title="Blog post not found"
    />
  );
}

async function renderBlogPostContent({
  slug,
  postSlug,
  locale,
  heroHoisted,
}: {
  slug: string;
  postSlug: string;
  locale?: string;
  heroHoisted?: boolean;
}) {
  const blogHref = isDomainIdentifier(slug) ? '/blog' : `/${slug}/blog`;

  // Over-long / repeatedly-encoded bot slugs can never match a post; bail
  // before getResolvedBlogPost (`'use cache'`) or getBlogPostRedirect
  // (`'use cache: remote'`) runs with an unbounded key.
  if (!evaluateStorefrontSlugSafety(postSlug).safe) {
    return renderBlogPostNotFound(blogHref);
  }

  const isDraftMode = (await draftMode()).isEnabled;
  const data = await getResolvedBlogPost(slug, postSlug, isDraftMode);

  if (!data) {
    const redirectedPost = await getBlogPostRedirect(slug, postSlug);
    if (redirectedPost) {
      permanentRedirect(
        asRoute(
          buildCanonicalBlogPostUrl(
            redirectedPost.merchant,
            redirectedPost.targetSlug
          )
        )
      );
    }

    return renderBlogPostNotFound(blogHref);
  }

  const { merchant, post, relatedPosts, relatedProducts } = data;
  const content = post.content || '';
  const baseUrl = buildStoreUrl(merchant);
  const blogIndexUrl = `${baseUrl}/blog`;
  const postUrl = buildCanonicalBlogPostUrl(merchant, post.slug);
  // On a merchant subdomain the proxy already mapped /blog/... into the internal
  // /{slug}/... route, so a naive `/${slug}` prefix double-prefixes the author
  // byline link. Resolve the prefix from the proxy-trusted merchant headers.
  const headersList = await headers();
  const basePath = isDomainIdentifier(slug)
    ? ''
    : getBlogStorefrontPathPrefix(headersList, merchant);
  const authorName = post.author_name?.trim() || merchant.business_name;
  const hasAuthorHub = Boolean(
    post.author_name && hasBlogAuthorPage(post.author_name, merchant.slug)
  );
  const authorSlug =
    hasAuthorHub && post.author_name ? generateSlug(post.author_name) : null;
  const authorHref = authorSlug
    ? `${basePath}/blog/author/${authorSlug}`
    : undefined;
  const authorUrl = authorSlug
    ? `${baseUrl}/blog/author/${authorSlug}`
    : baseUrl;
  const authorId = authorSlug ? `${baseUrl}#author-${authorSlug}` : undefined;
  const structuredData = buildBlogPostStructuredData({
    catalogPrices: { products: relatedProducts, currencySource: merchant },
    author: {
      id: authorId,
      image: post.author_image_url ?? undefined,
      name: authorName,
      url: authorUrl,
    },
    baseUrl,
    blogIndexUrl,
    content,
    merchant,
    post,
    postUrl,
  });

  const clusterModel = await buildInformationalClusterModel({
    merchantId: merchant.id,
    merchantSlug: merchant.slug,
    storeUrl: baseUrl,
    countryCode: merchant.country,
    post: {
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      category: post.category,
      tags: post.tags,
      keywords: post.keywords,
      featured_image_url: post.featured_image_url,
      published_at: post.published_at,
      reading_time_minutes: post.reading_time_minutes,
    },
  });

  const beforeChrome = (
    <>
      {isDraftMode && (
        <div className="bg-amber-600 text-white py-2 px-4 flex items-center justify-center gap-2 sticky top-0 z-50 shadow-md">
          <AlertTriangle className="size-4" />
          <span className="text-sm font-medium">
            Preview Mode: Showing unpublished draft
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="text-white hover:bg-amber-700 h-7 text-xs ml-4 border border-white/20"
            asChild
          >
            <Link href="/api/blog/exit-preview">Exit Preview</Link>
          </Button>
        </div>
      )}
      <JsonLd data={structuredData.organizationSchema} />
      <JsonLd data={structuredData.blogSchema} />
      <JsonLd data={structuredData.breadcrumbSchema} />
      {structuredData.faqSchema && <JsonLd data={structuredData.faqSchema} />}
      {structuredData.videoMetadata?.schema && (
        <JsonLd data={structuredData.videoMetadata.schema} />
      )}
      <ViewCounter postId={post.id} />
    </>
  );

  const body = (
    <>
      <Suspense fallback={<BlogPostBodyFallback />}>
        <BlogPostBody
          basePath={basePath}
          baseUrl={baseUrl}
          currencySource={{
            country: merchant.country,
            payout_currency: merchant.payout_currency,
          }}
          content={content}
          locale={locale}
          // Draft preview must keep draft-to-draft links intact: the dead-link
          // resolver only treats published posts as live, so it would unwrap
          // links an editor needs to validate. resolveContentLinks
          // short-circuits when merchantId is undefined.
          merchantId={isDraftMode ? undefined : merchant.id}
          merchantSlug={merchant.slug}
          postUrl={postUrl}
          post={{
            author_bio: post.author_bio,
            id: post.id,
            slug: post.slug,
            tags: post.tags,
            title: post.title,
            featured_image_url: post.featured_image_url,
          }}
          video={structuredData.videoMetadata?.video ?? null}
          relatedProducts={relatedProducts}
          relatedPosts={relatedPosts}
        />
      </Suspense>

      <InformationalClusterPanel model={clusterModel} />
    </>
  );

  if (heroHoisted) {
    // The page-root static shell already rendered the hero + header + chrome
    // from the cached post; stream only the body region into that shell.
    return (
      <>
        {beforeChrome}
        {body}
      </>
    );
  }

  return (
    <BlogPostShell
      beforeChrome={beforeChrome}
      blogHref={`${basePath}/blog`}
      header={{
        author_bio: post.author_bio,
        author_name: post.author_name,
        author_title: post.author_title,
        authorHref,
        category: post.category,
        locale,
        published_at: post.published_at,
        reading_time_minutes: post.reading_time_minutes,
        title: post.title,
      }}
      hero={{
        alt: post.featured_image_alt || post.title,
        src: post.featured_image_url || '/placeholder.png',
      }}
    >
      {body}
    </BlogPostShell>
  );
}

export default async function BlogPostPageContent({
  params,
  heroHoisted,
}: BlogPostPageContentProps) {
  const { slug, postSlug } = await params;
  const headersList = await headers();
  const locale = getRequestLocale(headersList);

  return renderBlogPostContent({ slug, postSlug, locale, heroHoisted });
}
