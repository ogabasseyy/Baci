import { type NextRequest, NextResponse } from 'next/server';
import { blogPostMediaPaths } from '@/app/api/admin/blog/upload/blog-media-tombstone-clear';
import {
  validateBlogDiscoverImageReadiness,
  validateBlogImageVariantIntegrity,
} from '@/lib/blog-discover-readiness';
import {
  calculateReadingTime,
  calculateWordCount,
  generateSlug,
} from '@/lib/blog-utils';
import { revalidatePlatformBlog } from '@/lib/cache-revalidation';
import { checkCsrfProtection } from '@/lib/csrf';
import { getPlatformAdminAuthForPermission } from '@/lib/platform-admin-auth';
import { createClient } from '@/lib/supabase/server';
import { sanitizeBlogPostData } from '@/lib/validations/blog';
import {
  adminPlatformBlogPostsListQuerySchema,
  createPostSchema,
} from '@/schemas/admin-platform-blog-posts';
import type { Json } from '@/types/supabase';

function toAuthErrorResponse(status: 'unauthenticated' | 'forbidden') {
  return status === 'unauthenticated'
    ? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    : NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPlatformCreateError(
  error: {
    code?: string;
    message?: string;
  } | null
): { error: string; status: 409 | 500 } {
  if (error?.code === '23505') {
    return { error: 'A post with this slug already exists', status: 409 };
  }
  if (
    error?.code === 'P0001' &&
    error.message?.includes('platform_blog_media_swept_during_save')
  ) {
    return { error: 'Referenced media was removed during save', status: 500 };
  }
  return { error: 'Failed to create platform blog post', status: 500 };
}

export async function GET(request: NextRequest) {
  const auth = await getPlatformAdminAuthForPermission('content.manage');
  if (auth.status !== 'authenticated') {
    return toAuthErrorResponse(auth.status);
  }

  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const parsedQuery = adminPlatformBlogPostsListQuerySchema.safeParse({
      limit: searchParams.get('limit') ?? undefined,
      offset: searchParams.get('offset') ?? undefined,
    });
    if (!parsedQuery.success) {
      return NextResponse.json(
        {
          error: 'Invalid query parameters',
          details: parsedQuery.error.flatten(),
        },
        { status: 400 }
      );
    }

    const { limit, offset } = parsedQuery.data;

    const { data, error, count } = await supabase
      .from('blog_posts')
      .select(
        'id, title, slug, excerpt, featured_image_url, category, status, author_name, reading_time_minutes, view_count, created_at, updated_at, published_at',
        { count: 'exact' }
      )
      .eq('is_platform_post', true)
      .is('merchant_id', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Failed to fetch platform blog posts:', error);
      return NextResponse.json(
        { error: 'Failed to fetch platform blog posts' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      hasMore: (count || 0) > offset + limit,
      limit,
      offset,
      posts: data || [],
      total: count || 0,
    });
  } catch (error) {
    console.error('Platform blog posts GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await getPlatformAdminAuthForPermission('content.manage');
  if (auth.status !== 'authenticated') {
    return toAuthErrorResponse(auth.status);
  }

  const { valid, response } = await checkCsrfProtection(request);
  if (!valid) {
    return (
      response ??
      NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!isJsonRecord(rawBody)) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }

  try {
    const body = sanitizeBlogPostData(rawBody);
    // A create with no intent must not store orphan provenance. The sanitizer
    // only clears explicitly supplied nullish intents (a missing key means
    // "leave stored values alone" on PATCH), so handle the missing key here
    // where a missing intent means the row will have NULL intent.
    if (
      (body.intent === null || body.intent === undefined) &&
      body.intent_source !== undefined
    ) {
      body.intent_source = null;
    }
    if (!body.slug && typeof body.title === 'string') {
      body.slug = generateSlug(body.title);
    }
    if (!body.author_name) {
      body.author_name = 'Baci Editorial';
    }

    const validated = createPostSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validated.error.flatten() },
        { status: 400 }
      );
    }

    const postData = validated.data;
    const variantIntegrity = validateBlogImageVariantIntegrity(postData, {
      kind: 'platform',
    });
    if (!variantIntegrity.ready) {
      return NextResponse.json(
        {
          error: 'Invalid featured image variants',
          code: variantIntegrity.code,
          details: variantIntegrity.details,
        },
        { status: 400 }
      );
    }

    if (postData.status === 'published') {
      const discoverReadiness = validateBlogDiscoverImageReadiness(postData, {
        kind: 'platform',
      });
      if (!discoverReadiness.ready) {
        return NextResponse.json(
          {
            error: 'Featured image is not Discover-ready',
            code: discoverReadiness.code,
            details: discoverReadiness.details,
          },
          { status: 400 }
        );
      }
    }

    const publishedAt =
      postData.status === 'published' ? new Date().toISOString() : null;

    // Scope is forced in SQL, so the guard columns must not travel:
    // the create whitelist rejects them as unknown fields.
    const createPayload: Record<string, unknown> = {
      ...postData,
      keywords: postData.keywords || [],
      published_at: publishedAt,
      reading_time_minutes: calculateReadingTime(postData.content),
      status: postData.status || 'draft',
      tags: postData.tags || [],
      word_count: calculateWordCount(postData.content),
    };

    const mediaRow = {
      author_image_url: postData.author_image_url ?? null,
      content: postData.content,
      excerpt: postData.excerpt ?? null,
      featured_image_url: postData.featured_image_url ?? null,
      featured_image_variants: postData.featured_image_variants ?? null,
    };

    const supabase = await createClient();
    const { data, error } = await supabase.rpc(
      'mutate_platform_blog_post_create_atomic',
      {
        p_media_paths: blogPostMediaPaths(mediaRow),
        // Zod-validated payloads are JSON-serializable; undefined
        // keys never survive the wire encoding.
        p_post_data: createPayload as unknown as Json,
      }
    );
    const row = Array.isArray(data) ? data[0] : data;

    if (error || !row) {
      const mapped = readPlatformCreateError(error);
      if (mapped.status === 500) {
        console.error('Failed to create platform blog post:', error);
      }
      return NextResponse.json(
        { error: mapped.error },
        { status: mapped.status }
      );
    }

    revalidatePlatformBlog(row.slug);
    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    console.error('Platform blog posts POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
