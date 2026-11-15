import { type NextRequest, NextResponse } from 'next/server';
import { resolveSelectedMerchantAccess } from '@/app/api/merchant/features/resolve-selected-merchant-access';
import { authenticateApiRequest, hasPermission } from '@/lib/api-auth';
import {
  validateBlogDiscoverImageReadiness,
  validateBlogImageVariantIntegrity,
} from '@/lib/blog-discover-readiness';
import { calculateReadingTime, calculateWordCount } from '@/lib/blog-utils';
import { checkCsrfProtection } from '@/lib/csrf';
import { blogPostSchema, sanitizeBlogPostData } from '@/lib/validations/blog';
import { parseBlogPostMutationBody } from '../blog-post-mutation-body';
import { persistBlogPostMutation } from '../persist-blog-post-mutation';
import { applyFeaturedImageDefaults } from './apply-featured-image-defaults';
import { featuredImageVariantsEqual } from './featured-image-variants';
import { loadBlogPostForUpdate } from './load-blog-post-for-update';
import type { RouteParams } from './route-params';
import { runBlogPostUpdateEffects } from './run-blog-post-update-effects';
import { validateUpdatedBlogPostSlug } from './validate-updated-blog-post-slug';

function blogPostError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}
export async function updateBlogPost(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user || !auth.supabase) {
      return NextResponse.json(
        { error: auth.error || 'Unauthorized' },
        { status: 401 }
      );
    }
    const { valid, response } = await checkCsrfProtection(request);
    if (!valid) {
      return (
        response ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }
    const { id } = await params;
    const selectedMerchant = await resolveSelectedMerchantAccess({
      requestedMerchantId: request.nextUrl.searchParams.get('merchantId'),
      supabase: auth.supabase,
      userId: auth.user.id,
    });
    if (selectedMerchant.invalidMerchantId) {
      return blogPostError('Invalid merchant ID', 400);
    }
    if (!selectedMerchant.access) {
      return blogPostError('Merchant not found', 404);
    }
    const access = selectedMerchant.access;
    if (!hasPermission(access, 'marketing', 'edit')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }
    const existingPostResult = await loadBlogPostForUpdate({
      merchantId: access.merchantId,
      postId: id,
      supabase: auth.supabase,
    });
    if (existingPostResult.kind === 'not-found') {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }
    if (existingPostResult.kind === 'error') {
      return blogPostError('Failed to load post', 500);
    }
    const existingPost = existingPostResult.post;
    const parsedBody = await parseBlogPostMutationBody(request);
    if (parsedBody.error) {
      return NextResponse.json({ error: parsedBody.error }, { status: 400 });
    }
    const validated = blogPostSchema.safeParse(
      sanitizeBlogPostData(parsedBody.body)
    );
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validated.error.flatten() },
        { status: 400 }
      );
    }
    const { embedded_products: embeddedProductIds, ...validatedPostData } =
      validated.data;
    const updateData: Record<string, unknown> = { ...validatedPostData };
    const featuredImageUrlChanged = applyFeaturedImageDefaults(
      updateData,
      existingPost
    );
    const featureSettings = await auth.supabase
      .from('merchant_feature_settings')
      .select('blog_enabled, blog_discover_image_validation_enabled')
      .eq('merchant_id', access.merchantId)
      .maybeSingle();
    if (featureSettings.error) {
      console.error('Failed to load blog feature settings:', {
        merchantId: access.merchantId,
        error: featureSettings.error,
      });
      return NextResponse.json(
        { error: 'Failed to load blog settings' },
        { status: 500 }
      );
    }
    const variantIntegrity = validateBlogImageVariantIntegrity(
      updateData,
      access.merchantId
    );
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
    const targetStatus =
      typeof updateData.status === 'string'
        ? updateData.status
        : existingPost.status;
    const featuredImageMetadataChanged =
      (Object.hasOwn(updateData, 'featured_image_width') &&
        updateData.featured_image_width !==
          existingPost.featured_image_width) ||
      (Object.hasOwn(updateData, 'featured_image_height') &&
        updateData.featured_image_height !==
          existingPost.featured_image_height) ||
      (Object.hasOwn(updateData, 'featured_image_variants') &&
        !featuredImageVariantsEqual(
          updateData.featured_image_variants,
          existingPost.featured_image_variants
        ));
    const publishingNow =
      targetStatus === 'published' && existingPost.status !== 'published';
    const effectiveImage = {
      featured_image_url:
        updateData.featured_image_url === undefined
          ? existingPost.featured_image_url
          : (updateData.featured_image_url as string | null),
      featured_image_width:
        updateData.featured_image_width === undefined
          ? existingPost.featured_image_width
          : (updateData.featured_image_width as number | null),
      featured_image_height:
        updateData.featured_image_height === undefined
          ? existingPost.featured_image_height
          : (updateData.featured_image_height as number | null),
      featured_image_variants:
        updateData.featured_image_variants === undefined
          ? (existingPost.featured_image_variants ?? {})
          : ((updateData.featured_image_variants as Record<
              string,
              unknown
            > | null) ?? {}),
    };
    const discoverImageReadiness =
      targetStatus === 'published'
        ? validateBlogDiscoverImageReadiness(effectiveImage, access.merchantId)
        : { ready: true as const };
    if (
      !discoverImageReadiness.ready &&
      featureSettings.data?.blog_discover_image_validation_enabled === true &&
      (publishingNow || featuredImageUrlChanged || featuredImageMetadataChanged)
    ) {
      return NextResponse.json(
        {
          error: 'Featured image is not Discover-ready',
          code: discoverImageReadiness.code,
          details: discoverImageReadiness.details,
        },
        { status: 400 }
      );
    }
    const slugValidation = await validateUpdatedBlogPostSlug({
      currentSlug: existingPost.slug,
      merchantId: access.merchantId,
      postId: id,
      slug: updateData.slug,
      supabase: auth.supabase,
    });
    if (slugValidation === 'error') {
      return NextResponse.json(
        { error: 'Failed to validate post slug' },
        { status: 500 }
      );
    }
    if (slugValidation === 'conflict') {
      return NextResponse.json(
        { error: 'A post with this slug already exists' },
        { status: 409 }
      );
    }
    if (updateData.content) {
      updateData.word_count = calculateWordCount(updateData.content as string);
      updateData.reading_time_minutes = calculateReadingTime(
        updateData.content as string
      );
    }
    if (
      targetStatus === 'scheduled' &&
      !updateData.published_at &&
      !existingPost.published_at
    ) {
      return blogPostError(
        'published_at is required when status is scheduled',
        400
      );
    }
    if (
      existingPost.status === 'published' &&
      targetStatus === 'published' &&
      (updateData.published_at !== undefined ||
        existingPost.published_at == null)
    ) {
      updateData.published_at =
        existingPost.published_at ??
        existingPost.requested_publish_at ??
        new Date().toISOString();
    } else if (
      updateData.status === 'published' &&
      existingPost.status !== 'published' &&
      !updateData.published_at
    ) {
      updateData.published_at = new Date().toISOString();
    }
    let persistence = await persistBlogPostMutation({
      embeddedProductIds,
      merchantId: access.merchantId,
      postData: updateData,
      postId: id,
      supabase: auth.supabase,
    });
    if (
      persistence.post === null &&
      persistence.code === 'scheduled_reservation_requires_reschedule_rpc'
    ) {
      if (typeof updateData.published_at !== 'string') {
        return blogPostError(
          'Reserved scheduled posts require a valid published_at timestamp to reschedule',
          409
        );
      }
      if (Number.isNaN(Date.parse(updateData.published_at))) {
        return blogPostError('Invalid published_at timestamp', 400);
      }
      const { published_at: newRequestedPublishAt, ...remainingUpdateData } =
        updateData;
      persistence = await persistBlogPostMutation({
        embeddedProductIds,
        merchantId: access.merchantId,
        postData: remainingUpdateData,
        postId: id,
        reschedulePublishAt: newRequestedPublishAt,
        supabase: auth.supabase,
      });
    }
    if (persistence.post === null) {
      return blogPostError(
        persistence.error ?? 'Failed to update post',
        persistence.status ?? 500
      );
    }
    const updatedPost = persistence.post;
    await runBlogPostUpdateEffects({
      existingCategory: existingPost.category,
      existingSlug: existingPost.slug,
      existingStatus: existingPost.status,
      featuredImageUrlChanged,
      merchantId: access.merchantId,
      shouldRegenerateEmbedding: Boolean(
        updateData.content || updateData.title || updateData.excerpt
      ),
      supabase: auth.supabase,
      updatedPost,
    });
    return NextResponse.json(
      discoverImageReadiness.ready
        ? updatedPost
        : { ...updatedPost, discoverImageReadiness }
    );
  } catch (error) {
    console.error('Blog post PATCH error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
