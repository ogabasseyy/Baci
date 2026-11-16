import { type NextRequest, NextResponse } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import {
  getPlatformBlogListing,
  getPlatformBlogPost,
  getPlatformBlogPostCacheTag,
  incrementPlatformBlogPostViews,
  PLATFORM_BLOG_CACHE_TAG,
  PLATFORM_BLOG_LIST_CACHE_TAG,
} from '@/lib/platform-blog';
import { trackBlogPostViewSchema } from '@/schemas/blog-post-view-count';

function parseSafeLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? '20', 10);
  if (!Number.isFinite(parsed)) {
    return 20;
  }

  return Math.min(Math.max(parsed, 1), 100);
}

function parseSafeOffset(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? '0', 10);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(parsed, 0);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const slug = searchParams.get('slug')?.trim().toLowerCase();
    const tag = searchParams.get('tag');

    if (slug) {
      const post = await getPlatformBlogPost(slug);
      if (!post) {
        return NextResponse.json({ error: 'Post not found' }, { status: 404 });
      }

      return NextResponse.json(post, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, must-revalidate',
          'Vercel-Cache-Tag': `${PLATFORM_BLOG_CACHE_TAG},${getPlatformBlogPostCacheTag(slug)}`,
        },
      });
    }

    const limit = parseSafeLimit(searchParams.get('limit'));
    const offset = parseSafeOffset(searchParams.get('offset'));
    const listing = await getPlatformBlogListing({
      category,
      limit,
      offset,
      tag,
    });

    return NextResponse.json(
      {
        hasMore: listing.hasMore,
        limit: listing.limit,
        offset,
        page: listing.page,
        posts: listing.posts,
        total: listing.total,
        totalPages: listing.totalPages,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, must-revalidate',
          'Vercel-Cache-Tag': `${PLATFORM_BLOG_CACHE_TAG},${PLATFORM_BLOG_LIST_CACHE_TAG}`,
        },
      }
    );
  } catch (error) {
    console.error('Error fetching blog posts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch blog posts' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const { valid, response } = await checkCsrfProtection(request);
  if (!valid) {
    return (
      response ??
      NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
    );
  }

  const bodyResult = await readBoundedJsonBody(request, 1024);
  if (!bodyResult.ok) {
    return NextResponse.json(
      {
        error:
          bodyResult.reason === 'too_large'
            ? 'Request body too large'
            : 'Invalid JSON body',
      },
      { status: bodyResult.reason === 'too_large' ? 413 : 400 }
    );
  }

  const parsed = trackBlogPostViewSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid blog post slug' },
      { status: 400 }
    );
  }

  const slug = parsed.data.slug.toLowerCase();
  const post = await getPlatformBlogPost(slug);
  if (!post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 });
  }

  try {
    await incrementPlatformBlogPostViews(post.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    // Preserve read availability even if analytics increments fail.
    console.error('Failed to increment platform blog post views:', {
      error,
      postId: post.id,
    });
    return NextResponse.json({ ok: false });
  }
}
