import { Feed } from 'feed';
import {
  transformImageTitlesToFigureCaptions,
  unescapeHtmlText,
} from '@/app/(storefront)/[slug]/(blog)/blog/[postSlug]/blog-post-image-html';
import {
  truncateFeedText,
  xmlSafeFeedImageUrl,
  xmlSafeFeedPathSegment,
  xmlSafeFeedUrl,
} from '@/lib/blog-feed-normalize';
import { getBlogStructuredDataImageUrls } from '@/lib/blog-structured-data-images';
import { stripHtml } from '@/lib/blog-utils';
import { getImageMimeType } from '@/lib/get-blog-feed-image-mime-type';
import { pinDeterministicFeedImageFormat } from '@/lib/pin-deterministic-feed-image-format';
import { isPublicBlogCategory } from '@/lib/public-blog-content-quality';
import { sanitizeForFeed } from '@/lib/sanitize';
import { stripInvalidXml10Characters } from '@/lib/sanitize-xml-10';

export interface BlogFeedPost {
  id: string;
  title: string;
  slug: string;
  content: string;
  excerpt: string | null;
  featured_image_url: string | null;
  featured_image_variants?: Record<string, unknown> | null;
  category: string | null;
  author_name: string | null;
  published_at: string | null;
  updated_at: string | null;
}

export interface BlogFeedMerchant {
  id: string;
  slug: string;
  business_name: string;
  site_description: string | null;
  logo_url: string | null;
  custom_domain?: string | null;
}

function parseValidDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function buildBlogRssFeedXml({
  baseUrl,
  merchant,
  posts,
}: {
  baseUrl: string;
  merchant: BlogFeedMerchant;
  posts: BlogFeedPost[];
}): string {
  const safeMerchantSlug = xmlSafeFeedPathSegment(merchant.slug);
  const customStoreUrl = merchant.custom_domain
    ? `https://${merchant.custom_domain}`
    : null;
  // A corrupt custom domain must not 500 the whole feed: fall back to the
  // slug-based store URL instead of letting new URL() throw below.
  const storeUrl =
    customStoreUrl && URL.parse(customStoreUrl)
      ? customStoreUrl
      : `${baseUrl}/${safeMerchantSlug}`;
  const feedUrl = new URL(
    `/api/blog/feed/${safeMerchantSlug}`,
    storeUrl
  ).toString();

  const postsWithValidDates = posts.flatMap((post) => {
    const publishedDate = parseValidDate(post.published_at);
    return publishedDate ? [{ post, publishedDate }] : [];
  });

  const lastBuildDate =
    postsWithValidDates.length === 0
      ? null
      : (postsWithValidDates[0]?.publishedDate ?? new Date());
  const feedText = stripInvalidXml10Characters;
  const safeStoreUrl = xmlSafeFeedUrl(storeUrl);
  const safeFeedUrl = xmlSafeFeedUrl(feedUrl);
  const safeBaseUrl = xmlSafeFeedUrl(baseUrl);

  const feed = new Feed({
    title: feedText(`${merchant.business_name} Blog`),
    description: feedText(
      merchant.site_description || `Latest posts from ${merchant.business_name}`
    ),
    id: `${safeStoreUrl}/blog`,
    link: `${safeStoreUrl}/blog`,
    language: 'en',
    image: xmlSafeFeedImageUrl(merchant.logo_url),
    favicon: `${safeBaseUrl}/favicon.ico`,
    copyright: feedText(
      `All rights reserved ${new Date().getFullYear()}, ${merchant.business_name}`
    ),
    ...(lastBuildDate ? { updated: lastBuildDate } : {}),
    generator: 'Baci E-commerce Platform',
    feedLinks: {
      rss2: safeFeedUrl,
    },
    author: {
      name: feedText(merchant.business_name),
      link: safeStoreUrl,
    },
  });

  for (const { post, publishedDate } of postsWithValidDates) {
    const postUrl = `${safeStoreUrl}/blog/${xmlSafeFeedPathSegment(post.slug)}`;
    const captionedContent = transformImageTitlesToFigureCaptions(
      post.content || ''
    );
    const excerpt =
      post.excerpt ||
      truncateFeedText(unescapeHtmlText(stripHtml(captionedContent)), 300);
    const sanitizedContent = sanitizeForFeed(captionedContent);
    const imageUrls = getBlogStructuredDataImageUrls(post);
    const rawPrimaryImageUrl = xmlSafeFeedImageUrl(imageUrls[0]);
    const primaryImageUrl = rawPrimaryImageUrl
      ? pinDeterministicFeedImageFormat(rawPrimaryImageUrl)
      : undefined;
    const primaryImageMimeType = primaryImageUrl
      ? getImageMimeType(primaryImageUrl)
      : undefined;
    const feedImage =
      primaryImageUrl && primaryImageMimeType
        ? {
            url: primaryImageUrl,
            type: primaryImageMimeType,
          }
        : undefined;

    feed.addItem({
      title: feedText(post.title),
      id: postUrl,
      link: postUrl,
      description: feedText(excerpt),
      content: sanitizedContent,
      author: [
        {
          name: feedText(post.author_name || merchant.business_name),
          link: safeStoreUrl,
        },
      ],
      date: publishedDate,
      image: feedImage,
      category:
        post.category && isPublicBlogCategory(post.category)
          ? [{ name: feedText(post.category) }]
          : undefined,
    });
  }

  return feed.rss2();
}
