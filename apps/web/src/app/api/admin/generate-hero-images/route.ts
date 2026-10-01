import { type NextRequest, NextResponse } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { getPlatformAdminAuthForPermission } from '@/lib/platform-admin-auth';
import { checkRateLimit } from '@/lib/rate-limiter';
import { createClient } from '@/lib/supabase/server';
import { adminGenerateHeroImagesRequestSchema } from '@/schemas/admin-generate-hero-images';
import { generateHeroImageBatch } from '@/services/hero-image-generator';

function toAuthErrorResponse(status: 'unauthenticated' | 'forbidden') {
  return status === 'unauthenticated'
    ? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    : NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

/**
 * API endpoint to generate hero images for a specific category
 * POST /api/admin/generate-hero-images
 */
export async function POST(request: NextRequest) {
  const auth = await getPlatformAdminAuthForPermission('content.manage');
  if (auth.status !== 'authenticated') {
    return toAuthErrorResponse(auth.status);
  }

  try {
    const { valid, response } = await checkCsrfProtection(request);
    if (!valid) {
      return (
        response ??
        NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      logger.warn({
        message: 'Invalid hero image generation JSON payload',
        error,
      });
      return NextResponse.json(
        { error: 'Invalid request payload' },
        { status: 400 }
      );
    }

    const parseResult = adminGenerateHeroImagesRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Invalid request payload',
          details: parseResult.error.flatten(),
        },
        { status: 400 }
      );
    }
    const { category, count } = parseResult.data;

    // Cost control: each call generates up to 20 Imagen images (billed per
    // image), so throttle per user — the middleware limiter is only per-IP.
    const supabase = await createClient();
    const withinRateLimit = await checkRateLimit(
      supabase,
      auth.user.id,
      'admin_ai_image_gen',
      5,
      1
    );
    if (!withinRateLimit) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', code: 'rate_limited' },
        { status: 429 }
      );
    }

    logger.info({ message: 'Generating hero images batch', category, count });

    const result = await generateHeroImageBatch(category, count);

    if (!result.success) {
      logger.error({
        message: 'Hero image generation failed',
        error: result.error,
      });
      return NextResponse.json(
        {
          code: 'hero_image_generation_failed',
          error: 'Unable to generate hero images.',
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      imageIds: result.imageIds,
      count: result.imageIds?.length || 0,
      message: `Successfully generated ${result.imageIds?.length || 0} hero images for ${category}`,
    });
  } catch (error) {
    logger.error({ message: 'Hero image generation API error', error });
    return NextResponse.json(
      {
        code: 'hero_image_generation_failed',
        error: 'Unable to generate hero images.',
      },
      { status: 500 }
    );
  }
}

/**
 * Get statistics about hero image pool
 * GET /api/admin/generate-hero-images
 */
export async function GET() {
  const auth = await getPlatformAdminAuthForPermission('content.manage');
  if (auth.status !== 'authenticated') {
    return toAuthErrorResponse(auth.status);
  }

  try {
    const supabase = await createClient();

    // Get statistics per category
    const { data: stats, error: statsError } = await supabase
      .from('ai_hero_images')
      .select('category, usage_count')
      .eq('is_active', true);

    if (statsError) {
      logger.error({
        message: 'Hero image stats query failed',
        error: statsError,
      });
      return NextResponse.json(
        { error: 'Failed to retrieve hero image statistics' },
        { status: 500 }
      );
    }

    // Aggregate statistics
    const categoryStats = stats.reduce(
      (
        acc: Record<
          string,
          { total: number; avgUsage: number; totalUsage: number }
        >,
        img: { category: string; usage_count: number }
      ) => {
        if (!acc[img.category]) {
          acc[img.category] = { total: 0, avgUsage: 0, totalUsage: 0 };
        }
        acc[img.category].total += 1;
        acc[img.category].totalUsage += img.usage_count;
        return acc;
      },
      {} as Record<
        string,
        { total: number; avgUsage: number; totalUsage: number }
      >
    );

    // Calculate averages
    Object.keys(categoryStats).forEach((cat) => {
      categoryStats[cat].avgUsage =
        categoryStats[cat].totalUsage / categoryStats[cat].total;
    });

    return NextResponse.json({
      success: true,
      statistics: categoryStats,
      totalImages: stats.length,
    });
  } catch (error) {
    logger.error({ message: 'Hero image stats API error', error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
