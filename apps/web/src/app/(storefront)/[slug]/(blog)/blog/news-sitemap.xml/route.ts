import type { PostgrestError } from '@supabase/supabase-js';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { filterPublicBlogPosts } from '@/lib/public-blog-content-quality';
import { isStorefrontSitemapPublished } from '@/lib/storefront-seo/is-storefront-sitemap-published';
import {
  createSitemapUnavailableResponse,
  resolveStorefrontSitemapContext,
} from '../../../sitemap-data';

// Region pinning lives in vercel.json `regions` (dub1) — `preferredRegion`
// is deprecated and removed.

const NEWS_SITEMAP_WINDOW_MS = 48 * 60 * 60 * 1000;
const NEWS_SITEMAP_MAX_CACHE_AGE_MS = 60 * 60 * 1000;
const NEWS_SITEMAP_CLOCK_SKEW_MARGIN_MS = 5 * 60 * 1000;
const NEWS_SITEMAP_QUERY_WINDOW_MS =
  NEWS_SITEMAP_WINDOW_MS -
  NEWS_SITEMAP_MAX_CACHE_AGE_MS -
  NEWS_SITEMAP_CLOCK_SKEW_MARGIN_MS;
const NEWS_SITEMAP_LIMIT = 1000;

interface NewsSitemapPostRow {
  slug: string;
  title: string | null;
  published_at: string | null;
  updated_at: string | null;
}

interface NewsSitemapEntry {
  loc: string;
  lastmod: string;
  publicationName: string;
  publicationLanguage: string;
  publicationDate: string;
  title: string;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function getValidIsoDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

export function buildNewsSitemapXml(entries: NewsSitemapEntry[]): string {
  const body = entries
    .map(
      (entry) =>
        '<url>' +
        `<loc>${escapeXml(entry.loc)}</loc>` +
        `<lastmod>${escapeXml(entry.lastmod)}</lastmod>` +
        '<news:news>' +
        '<news:publication>' +
        `<news:name>${escapeXml(entry.publicationName)}</news:name>` +
        `<news:language>${escapeXml(entry.publicationLanguage)}</news:language>` +
        '</news:publication>' +
        `<news:publication_date>${escapeXml(entry.publicationDate)}</news:publication_date>` +
        `<news:title>${escapeXml(entry.title)}</news:title>` +
        '</news:news>' +
        '</url>'
    )
    .join('');

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">' +
    body +
    '</urlset>'
  );
}

export function buildNewsSitemapEntries({
  posts,
  publicationName,
  storeUrl,
}: {
  posts: NewsSitemapPostRow[];
  publicationName: string;
  storeUrl: string;
}): NewsSitemapEntry[] {
  return filterPublicBlogPosts(posts).flatMap((post) => {
    const publicationDate = getValidIsoDate(post.published_at);
    const title = post.title?.trim();

    if (!publicationDate || !title) {
      return [];
    }

    const lastmod = getValidIsoDate(post.updated_at) || publicationDate;

    return [
      {
        loc: `${storeUrl}/blog/${post.slug}`,
        lastmod,
        publicationName,
        publicationLanguage: 'en',
        publicationDate,
        title,
      },
    ];
  });
}

function createNewsSitemapResponse(entries: NewsSitemapEntry[]): NextResponse {
  return new NextResponse(buildNewsSitemapXml(entries), {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, s-maxage=1800, stale-while-revalidate=1800',
      'x-content-type-options': 'nosniff',
    },
  });
}

export interface NewsSitemapRouteContext {
  params: Promise<{ slug: string }>;
}

export async function GET(
  request: Request,
  routeContext: NewsSitemapRouteContext
): Promise<Response> {
  const { slug } = await routeContext.params;
  const headersList = await headers();
  const sitemapContext = await resolveStorefrontSitemapContext(
    headersList,
    slug,
    request
  );

  if (!sitemapContext) {
    return createSitemapUnavailableResponse();
  }

  const { merchant, storeUrl, supabase } = sitemapContext;
  if (
    !isStorefrontSitemapPublished(merchant) ||
    !merchant.feature_settings?.blog_enabled
  ) {
    return createNewsSitemapResponse([]);
  }

  // Reserve the full possible CDN age plus processing/clock-skew margin inside
  // Google's 48-hour window, so stale XML cannot retain an expired entry.
  const cutoffIso = new Date(
    Date.now() - NEWS_SITEMAP_QUERY_WINDOW_MS
  ).toISOString();
  const { data: posts, error } = (await supabase
    .from('blog_posts')
    .select('slug, title, published_at, updated_at')
    .eq('merchant_id', merchant.id)
    .eq('status', 'published')
    .not('published_at', 'is', null)
    .gte('published_at', cutoffIso)
    .order('published_at', { ascending: false })
    .limit(NEWS_SITEMAP_LIMIT)) as {
    data: NewsSitemapPostRow[] | null;
    error: PostgrestError | null;
  };

  if (error) {
    throw new Error('Failed to fetch blog posts for Google News sitemap', {
      cause: error,
    });
  }

  const entries = buildNewsSitemapEntries({
    posts: posts || [],
    publicationName: merchant.business_name || merchant.slug || 'Publication',
    storeUrl,
  });

  return createNewsSitemapResponse(entries);
}
