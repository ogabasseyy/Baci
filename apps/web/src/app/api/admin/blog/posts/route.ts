import { type NextRequest, NextResponse } from 'next/server';
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

const PLATFORM_BLOG_DETAIL_SELECT =
  'id, title, slug, content, excerpt, featured_image_url, featured_image_alt, featured_image_width, featured_image_height, featured_image_variants, category, tags, keywords, author_name, author_title, author_image_url, author_bio, status, seo_title, seo_description, focus_keyword, word_count, reading_time_minutes, view_count, created_at, updated_at, published_at';

function toAuthErrorResponse(status: 'unauthenticated' | 'forbidden') {
  return status === 'unauthenticated'
    ? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    : NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

    const insertData = {
      ...postData,
      is_platform_post: true,
      keywords: postData.keywords || [],
      merchant_id: null,
      published_at: publishedAt,
      reading_time_minutes: calculateReadingTime(postData.content),
      status: postData.status || 'draft',
      tags: postData.tags || [],
      word_count: calculateWordCount(postData.content),
    };

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('blog_posts')
      .insert(insertData)
      .select(PLATFORM_BLOG_DETAIL_SELECT)
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'A post with this slug already exists' },
          { status: 409 }
        );
      }

      console.error('Failed to create platform blog post:', error);
      return NextResponse.json(
        { error: 'Failed to create platform blog post' },
        { status: 500 }
      );
    }

    revalidatePlatformBlog(data.slug);
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error('Platform blog posts POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
