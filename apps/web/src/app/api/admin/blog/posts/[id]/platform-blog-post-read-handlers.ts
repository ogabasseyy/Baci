import { NextResponse } from 'next/server';
import { z } from 'zod';
import { revalidatePlatformBlog } from '@/lib/cache-revalidation';
import { createClient } from '@/lib/supabase/server';
import { platformBlogRouteParamsSchema } from '@/schemas/platform-blog-route-params';
import {
  PLATFORM_BLOG_DETAIL_SELECT,
  type PlatformBlogRouteParams,
} from './platform-blog-post-route-schema';

export async function getPlatformBlogPost({ params }: PlatformBlogRouteParams) {
  try {
    const parsedParams = platformBlogRouteParamsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json(
        {
          error: 'Invalid route parameters',
          details: z.flattenError(parsedParams.error),
        },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('blog_posts')
      .select(PLATFORM_BLOG_DETAIL_SELECT)
      .eq('id', parsedParams.data.id)
      .eq('is_platform_post', true)
      .is('merchant_id', null)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Post not found' }, { status: 404 });
      }

      console.error('Failed to fetch platform blog post:', error);
      return NextResponse.json(
        { error: 'Failed to fetch platform blog post' },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Platform blog post GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function deletePlatformBlogPost({
  params,
}: PlatformBlogRouteParams) {
  try {
    const parsedParams = platformBlogRouteParamsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json(
        {
          error: 'Invalid route parameters',
          details: z.flattenError(parsedParams.error),
        },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { data: existing, error: existingError } = await supabase
      .from('blog_posts')
      .select('slug')
      .eq('id', parsedParams.data.id)
      .eq('is_platform_post', true)
      .is('merchant_id', null)
      .single();

    if (existingError) {
      if (existingError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Post not found' }, { status: 404 });
      }

      console.error('Failed to fetch post for deletion:', existingError);
      return NextResponse.json(
        { error: 'Failed to delete platform blog post' },
        { status: 500 }
      );
    }

    const { error } = await supabase
      .from('blog_posts')
      .delete()
      .eq('id', parsedParams.data.id)
      .eq('is_platform_post', true)
      .is('merchant_id', null);

    if (error) {
      console.error('Failed to delete platform blog post:', error);
      return NextResponse.json(
        { error: 'Failed to delete platform blog post' },
        { status: 500 }
      );
    }

    revalidatePlatformBlog(existing.slug);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Platform blog post DELETE error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
