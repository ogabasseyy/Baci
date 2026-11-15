import { type NextRequest, NextResponse } from 'next/server';
import { resolveSelectedMerchantAccess } from '@/app/api/merchant/features/resolve-selected-merchant-access';
import { authenticateApiRequest, hasPermission } from '@/lib/api-auth';
import {
  validateBlogDiscoverImageReadiness,
  validateBlogImageVariantIntegrity,
} from '@/lib/blog-discover-readiness';
import {
  calculateReadingTime,
  calculateWordCount,
  extractKeywords,
  generateExcerpt,
  generateSeoDescription,
} from '@/lib/blog-utils';
import { revalidateBlogPosts } from '@/lib/cache-revalidation';
import { checkCsrfProtection } from '@/lib/csrf';
import { getBlogEmbeddingText } from '@/lib/embeddings';
import { getMerchantBlogRevalidationContext } from '@/lib/get-merchant-blog-cache-identifiers';
import { parseBlogPostMutationBody } from './blog-post-mutation-body';
import { loadBlogPostMerchant } from './load-blog-post-merchant';
import { persistBlogPostMutation } from './persist-blog-post-mutation';
import { scheduleCreatedPostPublicationEffects } from './post-publication-effects';
import { prepareCreateBlogPostInput } from './prepare-create-blog-post-input';
export async function createBlogPost(request: NextRequest) {
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
    const parsedBody = await parseBlogPostMutationBody(request);
    if (parsedBody.error)
      return NextResponse.json({ error: parsedBody.error }, { status: 400 });
    const preparedInput = prepareCreateBlogPostInput(parsedBody.body);
    if (!preparedInput.validation.success) {
      return NextResponse.json(
        {
          error: 'Validation error',
          details: preparedInput.validation.error.flatten(),
        },
        { status: 400 }
      );
    }
    const selectedMerchant = await resolveSelectedMerchantAccess({
      requestedMerchantId: request.nextUrl.searchParams.get('merchantId'),
      supabase: auth.supabase,
      userId: auth.user.id,
    });
    if (selectedMerchant.invalidMerchantId) {
      return NextResponse.json(
        { error: 'Invalid merchant ID' },
        { status: 400 }
      );
    }
    if (!selectedMerchant.access) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }
    const access = selectedMerchant.access;
    if (!hasPermission(access, 'marketing', 'create')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const merchantLookup = await loadBlogPostMerchant({
      merchantId: access.merchantId,
      supabase: auth.supabase,
    });
    if (merchantLookup.kind === 'not-found') {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }
    if (merchantLookup.kind === 'error') {
      return NextResponse.json(
        { error: 'Failed to load merchant details' },
        { status: 500 }
      );
    }
    if (!merchantLookup.slug) {
      console.warn(
        'Merchant slug missing during blog post revalidation; falling back to available blog identifiers only',
        { merchantId: access.merchantId }
      );
    }
    const merchantId = access.merchantId;
    const merchantBusinessName = merchantLookup.businessName || 'Store Owner';
    const { data: features, error: featuresError } = await auth.supabase
      .from('merchant_feature_settings')
      .select('blog_enabled, blog_discover_image_validation_enabled')
      .eq('merchant_id', merchantId)
      .maybeSingle();
    if (featuresError) {
      console.error('Failed to fetch blog feature settings:', {
        merchantId,
        error: featuresError,
      });
      return NextResponse.json(
        { error: 'Failed to load blog settings' },
        { status: 500 }
      );
    }
    if (!features?.blog_enabled) {
      return NextResponse.json(
        {
          error:
            'Blog feature is not enabled. Enable it in Settings > Features.',
        },
        { status: 403 }
      );
    }
    const finalValidation = prepareCreateBlogPostInput({
      ...preparedInput.validation.data,
      author_name: preparedInput.body.author_name || merchantBusinessName,
    }).validation;
    if (!finalValidation.success)
      return NextResponse.json(
        { error: 'Validation error', details: finalValidation.error.flatten() },
        { status: 400 }
      );
    const { embedded_products: embeddedProductIds, ...postData } =
      finalValidation.data;
    const variantIntegrity = validateBlogImageVariantIntegrity(
      postData,
      merchantId
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
    const discoverImageReadiness =
      postData.status === 'published'
        ? validateBlogDiscoverImageReadiness(postData, merchantId)
        : { ready: true as const };
    if (
      !discoverImageReadiness.ready &&
      features.blog_discover_image_validation_enabled
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
    const { data: existingPost, error: existingPostError } = await auth.supabase
      .from('blog_posts')
      .select('id')
      .eq('merchant_id', merchantId)
      .eq('slug', postData.slug)
      .maybeSingle();
    if (existingPostError) {
      console.error('Failed to validate blog post slug:', {
        merchantId,
        slug: postData.slug,
        error: existingPostError,
      });
      return NextResponse.json(
        { error: 'Failed to validate post slug' },
        { status: 500 }
      );
    }
    if (existingPost) {
      return NextResponse.json(
        { error: 'A post with this slug already exists' },
        { status: 409 }
      );
    }
    const autoExcerpt = postData.excerpt || generateExcerpt(postData.content);
    const autoKeywords = postData.keywords?.length
      ? postData.keywords
      : extractKeywords(postData.title, postData.content);
    const insertData = {
      merchant_id: merchantId,
      title: postData.title,
      slug: postData.slug,
      content: postData.content,
      excerpt: autoExcerpt,
      featured_image_url: postData.featured_image_url,
      featured_image_width: postData.featured_image_width,
      featured_image_height: postData.featured_image_height,
      featured_image_variants: postData.featured_image_variants ?? {},
      featured_image_alt: postData.featured_image_alt,
      category: postData.category,
      tags: postData.tags || [],
      keywords: autoKeywords,
      author_name: postData.author_name,
      author_title: postData.author_title,
      author_image_url: postData.author_image_url,
      author_bio: postData.author_bio,
      status: postData.status || 'draft',
      seo_title: postData.seo_title || postData.title.substring(0, 70),
      seo_description:
        postData.seo_description || generateSeoDescription(postData.content),
      focus_keyword:
        postData.focus_keyword ||
        (autoKeywords.length > 0 ? autoKeywords[0] : undefined),
      word_count: calculateWordCount(postData.content),
      reading_time_minutes: calculateReadingTime(postData.content),
      published_at:
        postData.status === 'published'
          ? new Date().toISOString()
          : postData.status === 'scheduled'
            ? (postData.published_at ?? null)
            : null,
    };
    const persistence = await persistBlogPostMutation({
      embeddedProductIds,
      merchantId,
      postData: insertData,
      postId: null,
      supabase: auth.supabase,
    });
    if (persistence.error) {
      return NextResponse.json(
        { error: persistence.error },
        { status: persistence.status }
      );
    }
    const newPost = persistence.post;
    if (newPost?.id) {
      const embeddingText = getBlogEmbeddingText({
        title: postData.title,
        excerpt: autoExcerpt,
        content: postData.content,
        category: postData.category,
      });
      void auth.supabase.functions
        .invoke('generate-embedding', {
          body: {
            id: newPost.id,
            text: embeddingText,
            type: 'blog',
          },
        })
        .then(({ error }) => {
          if (error) console.error('Failed to generate blog embedding:', error);
        })
        .catch((error) =>
          console.error('Failed to generate blog embedding:', error)
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
        listingCategories: newPost?.category ? [newPost.category] : [],
        postSlugs: [newPost?.slug || postData.slug],
      });
    } catch (error) {
      console.error('Failed post-publication blog revalidation:', {
        merchantId: access.merchantId,
        postSlug: newPost?.slug || postData.slug,
        error,
      });
    }
    if (newPost?.status === 'published') {
      scheduleCreatedPostPublicationEffects({
        blogRevalidation,
        post: newPost,
        supabase: auth.supabase,
      });
    }
    return NextResponse.json(
      discoverImageReadiness.ready
        ? newPost
        : { ...newPost, discoverImageReadiness },
      { status: 201 }
    );
  } catch (error) {
    console.error('Blog posts POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
