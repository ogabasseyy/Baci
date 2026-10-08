import { type NextRequest, NextResponse } from 'next/server';
import { resolveSelectedMerchantAccess } from '@/app/api/merchant/features/resolve-selected-merchant-access';
import { authenticateApiRequest, hasPermission } from '@/lib/api-auth';
import {
  validateBlogDiscoverImageReadiness,
  validateBlogImageVariantIntegrity,
} from '@/lib/blog-discover-readiness';
import { calculateReadingTime, calculateWordCount } from '@/lib/blog-utils';
import { revalidateBlogPosts } from '@/lib/cache-revalidation';
import { checkCsrfProtection } from '@/lib/csrf';
import { getBlogEmbeddingText } from '@/lib/embeddings';
import { getMerchantBlogRevalidationContext } from '@/lib/get-merchant-blog-cache-identifiers';
import { blogPostSchema, sanitizeBlogPostData } from '@/lib/validations/blog';
import { parseBlogPostMutationBody } from '../blog-post-mutation-body';
import { persistBlogPostMutation } from '../persist-blog-post-mutation';
import { applyFeaturedImageDefaults } from './apply-featured-image-defaults';
import { featuredImageVariantsEqual } from './featured-image-variants';
import { loadBlogPostForUpdate } from './load-blog-post-for-update';
import type { RouteParams } from './route-params';
import { scheduleUpdatedPostEffects } from './updated-post-effects';
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
      updateData.status === 'published' &&
      existingPost.status !== 'published' &&
      !updateData.published_at
    ) {
      updateData.published_at = new Date().toISOString();
    }
    const persistence = await persistBlogPostMutation({
      embeddedProductIds,
      existingPost,
      merchantId: access.merchantId,
      postData: updateData,
      postId: id,
      supabase: auth.supabase,
    });
    if (persistence.post === null) {
      return NextResponse.json(
        { error: persistence.error ?? 'Failed to update post' },
        { status: persistence.status ?? 500 }
      );
    }
    const updatedPost = persistence.post;
    if (
      updatedPost &&
      (updateData.content || updateData.title || updateData.excerpt)
    ) {
      const embeddingText = getBlogEmbeddingText({
        title: updatedPost.title,
        excerpt: updatedPost.excerpt,
        content: updatedPost.content,
        category: updatedPost.category,
      });
      void auth.supabase.functions
        .invoke('generate-embedding', {
          body: {
            id: updatedPost.id,
            text: embeddingText,
            type: 'blog',
          },
        })
        .then(({ error }) => {
          if (error)
            console.error('Failed to regenerate blog embedding:', error);
        })
        .catch((error) =>
          console.error('Failed to regenerate blog embedding:', error)
        );
    }
    let blogRevalidation:
      | Awaited<ReturnType<typeof getMerchantBlogRevalidationContext>>
      | undefined;
    try {
      blogRevalidation = await getMerchantBlogRevalidationContext(
        auth.supabase,
        access.merchantId
      );
      revalidateBlogPosts({
        merchantId: access.merchantId,
        identifiers: blogRevalidation.identifiers,
        canonicalMerchantSlug: blogRevalidation.canonicalMerchantSlug,
        listingCategories: [existingPost.category, updatedPost.category].filter(
          (category): category is string => Boolean(category)
        ),
        postSlugs: [existingPost.slug, updatedPost.slug],
      });
    } catch (error) {
      console.error('Failed post-publication blog revalidation:', {
        merchantId: access.merchantId,
        postSlug: updatedPost.slug,
        error,
      });
    }
    scheduleUpdatedPostEffects({
      blogRevalidation,
      featuredImageUrlChanged,
      post: updatedPost,
      publishingNow,
      supabase: auth.supabase,
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
