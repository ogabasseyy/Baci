import { generateText } from 'ai';
import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { activeImageModel } from '@/ai/provider';
import { checkCsrfProtection } from '@/lib/csrf';
import { getMerchantForApiRequest } from '@/lib/get-merchant-for-api-request';
import { logger } from '@/lib/logger';
import { productCacheRevalidation } from '@/lib/product-cache-revalidation';
import { checkRateLimit } from '@/lib/rate-limiter';
import { adminGenerateProductImagesQuerySchema } from '@/schemas/admin-generate-product-images';

interface GeminiAIResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        inlineData?: {
          data: string;
          mimeType: string;
        };
      }>;
    };
  }>;
}

import { createClient } from '@/lib/supabase/server';

const BATCH_SIZE = 3;
const TARGET_IMAGE_COUNT = 4;

export const maxDuration = 60; // Allow 60 seconds for execution

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { valid, response } = await checkCsrfProtection(req);
    if (!valid) {
      return (
        response ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }

    const { searchParams } = new URL(req.url);
    const parsedQuery = adminGenerateProductImagesQuerySchema.safeParse({
      parent_product_id: searchParams.get('parent_product_id') ?? undefined,
    });
    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: 'Invalid parent product identifier' },
        { status: 400 }
      );
    }

    const { data: canManageContent, error: permissionError } =
      await supabase.rpc('current_user_has_platform_admin_permission_v1', {
        p_permission: 'content.manage',
      });
    if (permissionError || !canManageContent) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Resolve merchant (supports both owners and staff)
    const merchantContext = await getMerchantForApiRequest(supabase, user.id);
    if (!merchantContext) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }

    // Admin routes require being the merchant owner, not staff
    if (merchantContext.staffAccess.isStaff) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const merchantId = merchantContext.merchantId;

    // Cost control: Imagen/Gemini image generation is billed per request, so
    // throttle per user (the middleware limiter is only per-IP). Matches the
    // documented image-generation budget of 5 req/min/user.
    const withinRateLimit = await checkRateLimit(
      supabase,
      user.id,
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

    const parentId = parsedQuery.data.parent_product_id;

    let query = supabase
      .from('products')
      .select('id, name, color, images, parent_product_id, slug')
      .eq('merchant_id', merchantId)
      .eq('status', 'active');

    if (parentId) {
      query = query.eq('parent_product_id', parentId);
    } else {
      query = query.not('images', 'is', null);
    }

    const { data: products, error: dbError } = await query.limit(10); // Fetch a few

    if (dbError) {
      logger.error({ message: 'Product image query failed', error: dbError });
      return NextResponse.json(
        {
          code: 'product_images_unavailable',
          error: 'Unable to load products for image generation.',
        },
        { status: 500 }
      );
    }

    const processed: Record<string, unknown>[] = [];
    const errors: Record<string, unknown>[] = [];
    const processedSlugs: string[] = [];

    const candidates = (products || [])
      .filter((p) => {
        const imgCount = Array.isArray(p.images) ? p.images.length : 0;
        const allowZero = !!parentId;
        return imgCount < TARGET_IMAGE_COUNT && (allowZero || imgCount > 0);
      })
      .slice(0, BATCH_SIZE);

    if (candidates.length === 0) {
      return NextResponse.json({
        message: 'No eligible products found needing images.',
      });
    }

    for (const product of candidates) {
      try {
        const currentImages = Array.isArray(product.images)
          ? product.images
          : [];
        const missingCount = TARGET_IMAGE_COUNT - currentImages.length;

        if (missingCount > 0) {
          const prompt = `Professional product photography of ${product.name} ${product.color ? `in ${product.color} color` : ''}, minimalist style, photorealistic, 4k resolution, white or light gray background, advertising quality.`;

          const { response } = await generateText({
            model: activeImageModel,
            prompt: prompt,
            providerOptions: {
              google: {
                responseModalities: ['IMAGE'],
              },
            },
          });

          const body = response.body as unknown as GeminiAIResponse;
          const content = body?.candidates?.[0]?.content;
          const parts = content?.parts || [];
          const imagePart = parts.find((p) => p.inlineData);

          let base64Data = null;
          let contentType = 'image/png';

          if (imagePart?.inlineData) {
            base64Data = imagePart.inlineData.data;
            contentType = imagePart.inlineData.mimeType || 'image/png';
          } else {
            logger.warn({
              message: 'Product image generation returned no image data',
              productId: product.id,
            });
          }

          if (!base64Data) {
            throw new Error('No image data returned from AI');
          }

          // Convert base64 to buffer
          const buffer = Buffer.from(base64Data, 'base64');

          // Generate unique filename
          const timestamp = Date.now();
          const filename = `${product.id}/gen_${timestamp}.png`;

          // 4. Upload to Supabase Storage
          const { data: _uploadData, error: uploadError } =
            await supabase.storage.from('images').upload(filename, buffer, {
              contentType,
              upsert: false,
            });

          if (uploadError) throw uploadError;

          // 5. Get Public URL
          const {
            data: { publicUrl },
          } = supabase.storage.from('images').getPublicUrl(filename);

          // 6. Update Product Record
          const newImages = [...currentImages, publicUrl];

          const { error: updateError } = await supabase
            .from('products')
            .update({ images: newImages })
            .eq('id', product.id)
            .eq('merchant_id', merchantId);

          if (updateError) throw updateError;

          processed.push({
            id: product.id,
            name: product.name,
            new_image: publicUrl,
          });
          const productSlug = product.slug?.trim() || product.id?.trim();
          if (productSlug) {
            processedSlugs.push(productSlug);
          }
        }
      } catch (err: unknown) {
        logger.error({
          message: 'Product image generation failed',
          productId: product.id,
          error: err,
        });
        errors.push({ code: 'image_generation_failed', id: product.id });
      }
    }

    if (processedSlugs.length > 0) {
      try {
        productCacheRevalidation.revalidateProducts(merchantId, undefined, {
          feedScope: 'merchant',
        });
        productCacheRevalidation.revalidateProductSlugs(
          merchantId,
          processedSlugs
        );
        // The products.images write above is covered by the transactional
        // cache-invalidation outbox trigger. That durable path performs the
        // ordered Vercel/Cloudflare eviction without importing edge-provider
        // credentials into this API route's authority graph.
      } catch (cacheError) {
        logger.warn({
          message: 'Skipped product cache refresh after image generation',
          cacheError,
        });
      }
    }

    if (processed.length === 0) {
      return NextResponse.json(
        {
          code: 'product_image_generation_failed',
          error: 'Unable to generate images for the selected products.',
          errors,
          processed,
          processed_count: 0,
          success: false,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      partial: errors.length > 0,
      processed_count: processed.length,
      processed,
      errors,
    });
  } catch (error: unknown) {
    logger.error({ message: 'Product image generation API error', error });
    return NextResponse.json(
      {
        code: 'product_image_generation_failed',
        error: 'Unable to generate product images.',
      },
      { status: 500 }
    );
  }
}
