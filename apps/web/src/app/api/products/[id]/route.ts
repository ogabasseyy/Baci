import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { getSupabaseServiceRoleKey } from '@/env';
import { hasPermission } from '@/lib/api-auth';
import { revalidateProducts } from '@/lib/cache-revalidation';
import { getCountryByCode } from '@/lib/countries';
import { checkCsrfProtection } from '@/lib/csrf';
import { deriveProductVariantWriteProjections } from '@/lib/derive-product-variant-projections';
import { getProductEmbeddingText } from '@/lib/embeddings';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import {
  getPrimaryProductImage,
  PRODUCT_IMAGE_LARGE_PLACEHOLDER_URL,
  PRODUCT_IMAGE_PLACEHOLDER_URL,
} from '@/lib/product-image';
import {
  PRODUCT_COLUMNS,
  PRODUCT_VARIANT_COLUMNS,
} from '@/lib/product-queries';
import { getEffectiveStock } from '@/lib/product-stock';
import {
  getSkuMatrixValidationError,
  inferProductVariantModel,
  normalizeProductVariantModel,
} from '@/lib/product-variant-model';
import type { Product, ProductVariant } from '@/lib/products';
import { sanitizeHtml } from '@/lib/sanitize';
import { sanitizeText } from '@/lib/sanitize-core';
import { sanitizeSchemaMarkup } from '@/lib/sanitize-json-ld';
import { scheduleProductImageTransformsPrewarm } from '@/lib/schedule-product-image-prewarm';
import { scheduleProductMutationPurge } from '@/lib/schedule-product-mutation-purge';
import {
  generateMetaDescription,
  generateProductSchema,
  generateProductSlug,
  generateSlug,
} from '@/lib/seo-utils';
import {
  resolveProductPurgeCategorySegmentForRow,
  type StorefrontProductPurgeEntry,
} from '@/lib/storefront-product-purge-urls';
import { createClient } from '@/lib/supabase/server';
import { formatZodErrors, updateProductSchema } from '@/schemas/products';

const PREDELETE_BLOG_POST_ID_LIMIT = 256;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const merchantContext = await getMerchantForApiRequest(supabase, user.id);
    if (!merchantContext) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }
    const access = toUserAccess(merchantContext);
    if (!hasPermission(access, 'products', 'view')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }
    const merchantId = merchantContext.merchantId;

    // Try to find by ID first, then by slug
    let query = supabase
      .from('products')
      .select(PRODUCT_COLUMNS)
      .eq('merchant_id', merchantId);

    // Check if id is a UUID
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id
      );

    if (isUuid) {
      query = query.eq('id', id);
    } else {
      query = query.eq('slug', id);
    }

    const { data: product, error: productError } = await query.single();

    if (productError || !product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    let variants: ProductVariant[] = [];
    if (product.has_variants) {
      const { data: v } = await supabase
        .from('product_variants')
        .select(PRODUCT_VARIANT_COLUMNS)
        .eq('product_id', product.id)
        .eq('merchant_id', merchantId)
        .returns<ProductVariant[]>();
      variants = v || [];
    }

    const primaryImage = getPrimaryProductImage(product.images);

    const fullProduct: Product = {
      id: product.id,
      name: product.name,
      description: product.description || '',
      status: product.status || 'draft',
      price: Number.parseFloat(product.price),
      manage_stock: product.manage_stock ?? true,
      stock: getEffectiveStock(product),
      minimum_order_quantity: 1,

      image: primaryImage || PRODUCT_IMAGE_PLACEHOLDER_URL,
      imageLarge: primaryImage || PRODUCT_IMAGE_LARGE_PLACEHOLDER_URL,
      imageHint: product.image_hint || '',
      images: product.images || [],

      brand: product.brand || '',
      gtin: product.gtin || '',
      mpn: product.mpn || '',
      google_product_category: product.google_product_category,

      has_variants: product.has_variants || false,
      category: product.category || 'General',
      color: product.color,

      sku: product.sku,
      slug: product.slug,
      compare_at_price: product.compare_at_price
        ? Number.parseFloat(product.compare_at_price)
        : undefined,
      cost_price: product.cost_price
        ? Number.parseFloat(product.cost_price)
        : undefined,
      low_stock_threshold: product.low_stock_threshold,
      variant_model:
        product.variant_model === 'sku_matrix' ? 'sku_matrix' : 'legacy',
      migration_status:
        product.migration_status === 'needs_review' ||
        product.migration_status === 'migrated'
          ? product.migration_status
          : 'pending',
      default_variant_id:
        typeof product.default_variant_id === 'string'
          ? product.default_variant_id
          : undefined,
      available_conditions: Array.isArray(product.available_conditions)
        ? (product.available_conditions as Product['available_conditions'])
        : undefined,
      min_variant_price:
        product.min_variant_price != null
          ? Number.parseFloat(String(product.min_variant_price))
          : undefined,
      max_variant_price:
        product.max_variant_price != null
          ? Number.parseFloat(String(product.max_variant_price))
          : undefined,

      weight_value: product.weight_value
        ? Number.parseFloat(product.weight_value)
        : undefined,
      weight_unit: product.weight_unit,
      dimensions: product.dimensions,

      taxable: product.taxable,
      tax_code: product.tax_code,

      condition: product.condition,
      condition_detail: product.condition_detail,

      meta_title: product.meta_title,
      meta_description: product.meta_description,
      keywords: product.keywords,
      canonical_url: product.canonical_url,
      schema_markup: product.schema_markup,

      variants: variants.map((v) => ({
        id: v.id,
        product_id: v.product_id,
        merchant_id: v.merchant_id,
        condition: v.condition,
        attributes: v.attributes,
        price_override: v.price_override,
        cost_price: v.cost_price,
        stock_quantity: v.stock_quantity,
        sku: v.sku,
        primary_image: v.primary_image,
        images: v.images || [],
      })),
    };

    return NextResponse.json({ product: fullProduct });
  } catch (error) {
    console.error('Error in GET /api/products/[id]:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { valid, response } = await checkCsrfProtection(request);
  if (!valid && response) return response;

  try {
    const { id } = await params;
    const rawBody = await request.json();
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    // Validate and sanitize input using Zod schema (2026 best practice)
    // updateProductSchema allows partial updates - only provided fields are validated
    const parseResult = updateProductSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: formatZodErrors(parseResult.error),
        },
        { status: 400 }
      );
    }

    // Use sanitized data from Zod transform
    const body = parseResult.data;

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get merchant record
    const merchantContext = await getMerchantForApiRequest(supabase, user.id);
    if (!merchantContext) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }
    const access = toUserAccess(merchantContext);
    if (!hasPermission(access, 'products', 'edit')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }
    const merchantId = merchantContext.merchantId;

    // Verify product belongs to merchant
    const { data: existingProduct, error: fetchError } = await supabase
      .from('products')
      .select(
        // `category` (legacy text), the direct `category_id` join (including
        // `is_active`), and the `product_categories` junction projection are read
        // here so the Cloudflare purge derives the OLD row's canonical segment
        // from the OLD data with the full PR #2914 precedence (active direct
        // join → active junction → legacy text). None of these are writable in this handler,
        // so they are also the product's current joined/junction categories.
        'id, name, description, brand, color, slug, category, condition, condition_detail, has_variants, variant_model, categories:category_id(slug, is_active), product_categories(category_id, categories(slug, is_active))'
      )
      .eq('id', id)
      .eq('merchant_id', merchantId)
      .single();

    if (fetchError || !existingProduct) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const existingVariantModel = normalizeProductVariantModel(
      existingProduct.variant_model
    );
    type RequestVariant = NonNullable<typeof body.variants>[number];
    const collectRequestVariantIds = (variants: RequestVariant[]) =>
      variants
        .map((variant) =>
          typeof variant.id === 'string'
            ? variant.id.trim().toLowerCase()
            : null
        )
        .filter(
          (variantId): variantId is string =>
            typeof variantId === 'string' && variantId.length > 0
        );
    let effectiveBodyVariants = body.variants;
    if (body.variants !== undefined && body.has_variants !== false) {
      const submittedVariantIds = collectRequestVariantIds(body.variants);
      const incomingVariantIds = Array.from(new Set(submittedVariantIds));

      if (incomingVariantIds.length > 0) {
        const { data: inventoryAnchors, error: inventoryAnchorsError } =
          await supabase
            .from('product_variants')
            .select('id')
            .eq('product_id', id)
            .eq('merchant_id', merchantId)
            .eq('is_inventory_anchor', true)
            .in('id', incomingVariantIds)
            .returns<Array<{ id: string }>>();

        if (inventoryAnchorsError) {
          console.error(
            'Error validating product variant anchors:',
            inventoryAnchorsError
          );
          return NextResponse.json(
            { error: 'Failed to validate product variants' },
            { status: 500 }
          );
        }

        const inventoryAnchorIds = new Set(
          (inventoryAnchors ?? []).map((variant) => variant.id)
        );
        if (inventoryAnchorIds.size > 0) {
          effectiveBodyVariants = body.variants.filter((variant) => {
            const variantId =
              typeof variant.id === 'string'
                ? variant.id.trim().toLowerCase()
                : null;
            return !variantId || !inventoryAnchorIds.has(variantId);
          });
        }
      }
    }
    const variantModel =
      body.variant_model !== undefined
        ? normalizeProductVariantModel(body.variant_model)
        : body.has_variants === false
          ? existingVariantModel
          : existingVariantModel === 'sku_matrix'
            ? 'sku_matrix'
            : effectiveBodyVariants !== undefined &&
                effectiveBodyVariants.length > 0
              ? inferProductVariantModel({ variants: effectiveBodyVariants })
              : existingVariantModel;
    const shouldValidateSkuMatrixInput =
      variantModel === 'sku_matrix' &&
      (body.variant_model !== undefined ||
        body.variants !== undefined ||
        body.has_variants === false);
    const nextHasVariants =
      body.has_variants !== undefined
        ? body.has_variants
        : body.variants !== undefined
          ? (effectiveBodyVariants?.length ?? 0) > 0
          : existingProduct.has_variants;
    const skuMatrixVariantsForValidation =
      existingVariantModel === 'sku_matrix' && variantModel === 'sku_matrix'
        ? effectiveBodyVariants?.map((variant) => {
            if (typeof variant.id !== 'string' || variant.id.trim() === '') {
              return variant;
            }

            return {
              ...variant,
              id: variant.id.trim().toLowerCase(),
              condition: Object.hasOwn(variant, 'condition')
                ? variant.condition
                : 'new',
              price_override: Object.hasOwn(variant, 'price_override')
                ? variant.price_override
                : 0,
            };
          })
        : effectiveBodyVariants;
    const skuMatrixValidationError = shouldValidateSkuMatrixInput
      ? getSkuMatrixValidationError({
          variantModel,
          hasVariants: nextHasVariants,
          variants: skuMatrixVariantsForValidation,
        })
      : null;

    if (skuMatrixValidationError) {
      return NextResponse.json(
        { error: skuMatrixValidationError },
        { status: 400 }
      );
    }

    const variantWriteProjections =
      body.variants !== undefined || body.has_variants !== undefined
        ? deriveProductVariantWriteProjections({
            fallbackColor:
              body.color !== undefined ? body.color : existingProduct.color,
            hasVariants: nextHasVariants,
            productImages: body.images,
            variants: effectiveBodyVariants,
          })
        : null;

    // Build updates object conditionally (2026 best practice: only update provided fields)
    // This prevents overwriting existing values with undefined on partial updates
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    // Core fields - only add if provided
    if (body.name !== undefined) {
      updates.name =
        typeof body.name === 'string' ? sanitizeText(body.name) : body.name;
    }
    // Sanitize description to prevent Stored XSS
    if (body.description !== undefined)
      updates.description =
        body.description !== null ? sanitizeHtml(body.description) : null;
    if (variantModel !== 'sku_matrix' && body.price !== undefined) {
      updates.price = body.price;
    }
    if (variantModel !== 'sku_matrix' && body.stock !== undefined) {
      updates.stock_quantity = body.stock;
    }

    // Generate slug only if name or condition changed
    if (body.slug !== undefined) {
      updates.slug = body.slug;
    } else if (body.name !== undefined) {
      updates.slug = generateProductSlug(
        body.name,
        variantModel === 'sku_matrix'
          ? existingProduct.condition
          : (body.condition ?? existingProduct.condition),
        body.condition_detail ?? existingProduct.condition_detail
      );
    }

    // Generate SKU only if explicitly provided or name changed
    if (body.sku !== undefined) {
      updates.sku = body.sku;
    } else if (body.name !== undefined) {
      updates.sku = generateSlug(body.name).toUpperCase().substring(0, 20);
    }

    // SEO fields - generate only if source changed
    if (body.meta_title !== undefined) {
      updates.meta_title =
        typeof body.meta_title === 'string'
          ? sanitizeText(body.meta_title)
          : body.meta_title;
    } else if (body.name !== undefined) {
      updates.meta_title = updates.name as string;
    }

    if (body.meta_description !== undefined) {
      updates.meta_description =
        typeof body.meta_description === 'string'
          ? sanitizeText(body.meta_description)
          : body.meta_description;
    } else if (body.description !== undefined && body.description !== null) {
      updates.meta_description = generateMetaDescription(
        updates.description as string
      );
    }

    // Pricing fields
    if (body.compare_at_price !== undefined)
      updates.compare_at_price = body.compare_at_price;
    if (body.cost_price !== undefined) updates.cost_price = body.cost_price;
    if (body.low_stock_threshold !== undefined)
      updates.low_stock_threshold = body.low_stock_threshold;

    // Image fields
    if (body.images !== undefined) {
      updates.images = body.images;
    }
    if (
      body.images === undefined &&
      (body.image !== undefined || body.imageLarge !== undefined)
    ) {
      const primaryImage = body.image ?? body.imageLarge;
      const sanitizedImage = primaryImage
        ? sanitizeText(primaryImage)
        : primaryImage;
      updates.images = sanitizedImage
        ? [
            {
              url: sanitizedImage,
              alt:
                (typeof updates.name === 'string'
                  ? updates.name
                  : sanitizeText(existingProduct.name)) || 'Product image',
              order: 0,
            },
          ]
        : [];
    }
    if (body.imageHint !== undefined) updates.image_hint = body.imageHint;

    // Physical attributes
    if (body.weight_value !== undefined)
      updates.weight_value = body.weight_value;
    if (body.weight_unit !== undefined) updates.weight_unit = body.weight_unit;
    if (body.dimensions !== undefined) updates.dimensions = body.dimensions;

    // Status fields
    if (body.status !== undefined) {
      updates.status = body.status;
    }

    // Tax fields
    if (body.taxable !== undefined) updates.taxable = body.taxable;
    if (body.tax_code !== undefined) updates.tax_code = body.tax_code;

    // Condition fields
    if (variantModel !== 'sku_matrix' && body.condition !== undefined) {
      updates.condition = body.condition;
    }
    if (body.condition_detail !== undefined)
      updates.condition_detail = body.condition_detail;

    // Additional SEO fields
    if (body.keywords !== undefined) {
      updates.keywords =
        typeof body.keywords === 'string'
          ? sanitizeText(body.keywords)
          : body.keywords;
    }
    if (body.canonical_url !== undefined) {
      updates.canonical_url =
        typeof body.canonical_url === 'string'
          ? sanitizeText(body.canonical_url)
          : body.canonical_url;
    }

    // Identifiers
    if (body.gtin !== undefined) updates.gtin = body.gtin;
    if (body.mpn !== undefined) updates.mpn = body.mpn;
    if (body.google_product_category !== undefined)
      updates.google_product_category = body.google_product_category;
    if (body.brand !== undefined) {
      updates.brand =
        typeof body.brand === 'string' ? sanitizeText(body.brand) : body.brand;
    }

    // Other fields
    if (body.fulfillment_details !== undefined)
      updates.fulfillment_details = body.fulfillment_details;
    if (body.has_variants !== undefined || body.variants !== undefined)
      updates.has_variants = nextHasVariants;
    const shouldUpdateVariantModel =
      body.variant_model !== undefined ||
      (effectiveBodyVariants !== undefined && effectiveBodyVariants.length > 0);
    const deferredVariantModelUpdates = shouldUpdateVariantModel
      ? {
          variant_model: variantModel,
          ...(variantModel === 'sku_matrix'
            ? { migration_status: 'migrated' as const }
            : {}),
        }
      : null;
    if (body.category !== undefined) updates.category = body.category;
    if (body.color !== undefined || variantWriteProjections) {
      updates.color = variantWriteProjections?.color ?? body.color;
    }

    // Schema markup - generate or sanitize
    if (body.schema_markup !== undefined) {
      updates.schema_markup = sanitizeSchemaMarkup(body.schema_markup);
    } else if (
      body.name !== undefined ||
      body.description !== undefined ||
      body.price !== undefined
    ) {
      // Regenerate schema if core product fields changed
      const schemaName = String(body.name ?? existingProduct.name ?? '');
      const schemaDescription = String(
        updates.description ?? existingProduct.description ?? ''
      );
      const schemaSku = String(updates.sku ?? '');

      // Fetch country and business_name for schema generation
      const { data: merchantDetails } = await supabase
        .from('merchants')
        .select('business_name, country')
        .eq('id', merchantId)
        .single();
      const businessName =
        merchantDetails?.business_name ?? merchantContext.businessName ?? '';
      const country = merchantDetails?.country
        ? getCountryByCode(merchantDetails.country)
        : undefined;
      const currency = country ? country.currency : 'USD';

      const productForSchema: Product = {
        id: id,
        name: schemaName,
        description: schemaDescription,
        price: body.price ?? 0,
        stock: body.stock ?? 0,
        manage_stock: body.manage_stock ?? true,
        status: (body.status ?? 'draft') as 'draft' | 'active' | 'archived',
        image: body.images?.[0]?.url || '',
        imageLarge: body.images?.[0]?.url || '',
        imageHint: body.imageHint || '',
        brand: body.brand || businessName,
        sku: schemaSku,
        gtin: body.gtin ?? '',
        mpn: body.mpn ?? '',
        weight_value: body.weight_value,
        weight_unit: body.weight_unit,
        condition: body.condition,
      };

      updates.schema_markup = generateProductSchema(
        productForSchema,
        businessName,
        currency
      );
    }

    let variantsToSync: Record<string, unknown>[] | null = null;
    const shouldSyncEmptyVariantClear =
      body.variants !== undefined &&
      body.variants.length === 0 &&
      body.has_variants !== false;
    if (effectiveBodyVariants !== undefined && body.has_variants !== false) {
      const variantHasOwn = (
        variant: RequestVariant,
        key: keyof RequestVariant
      ) => Object.hasOwn(variant, key);

      variantsToSync = effectiveBodyVariants.map((variant: RequestVariant) => {
        const normalizedVariantId =
          typeof variant.id === 'string'
            ? variant.id.toLowerCase()
            : variant.id;
        const payload: Record<string, unknown> = { id: normalizedVariantId };
        if (variantHasOwn(variant, 'attributes')) {
          payload.attributes = variant.attributes ?? {};
        }
        if (variantHasOwn(variant, 'condition')) {
          payload.condition = variant.condition ?? null;
        }
        if (variantHasOwn(variant, 'price_override')) {
          payload.price_override = variant.price_override ?? null;
        }
        if (variantHasOwn(variant, 'cost_price')) {
          payload.cost_price = variant.cost_price ?? null;
        }
        if (variantHasOwn(variant, 'stock_quantity')) {
          payload.stock_quantity = variant.stock_quantity ?? 0;
        }
        if (variantHasOwn(variant, 'sku')) {
          payload.sku = variant.sku ?? null;
        }
        if (variantHasOwn(variant, 'primary_image')) {
          payload.primary_image = variant.primary_image ?? null;
        }
        if (variantHasOwn(variant, 'images')) {
          payload.images = variant.images ?? [];
        }
        return payload;
      });

      if (variantsToSync.length === 0 && !shouldSyncEmptyVariantClear) {
        variantsToSync = null;
      }

      const collectVariantIds = (variants: Record<string, unknown>[]) =>
        variants
          .map((variant) => variant.id)
          .filter(
            (variantId): variantId is string =>
              typeof variantId === 'string' && variantId.length > 0
          );
      const submittedVariantIds = variantsToSync
        ? collectVariantIds(variantsToSync)
        : [];
      const incomingVariantIds = Array.from(new Set(submittedVariantIds));

      if (incomingVariantIds.length !== submittedVariantIds.length) {
        return NextResponse.json(
          { error: 'Duplicate product variant update' },
          { status: 400 }
        );
      }

      if (incomingVariantIds.length > 0) {
        const { data: ownedVariants, error: ownedVariantsError } =
          await supabase
            .from('product_variants')
            .select('id')
            .eq('product_id', id)
            .eq('merchant_id', merchantId)
            .eq('is_inventory_anchor', false)
            .in('id', incomingVariantIds)
            .returns<Array<{ id: string }>>();

        if (ownedVariantsError) {
          console.error(
            'Error validating product variants:',
            ownedVariantsError
          );
          return NextResponse.json(
            { error: 'Failed to validate product variants' },
            { status: 500 }
          );
        }

        const ownedVariantIds = new Set(
          (ownedVariants ?? []).map((variant) => variant.id)
        );
        const hasInvalidVariantId = incomingVariantIds.some(
          (variantId) => !ownedVariantIds.has(variantId)
        );
        if (hasInvalidVariantId) {
          return NextResponse.json(
            { error: 'Invalid product variant update' },
            { status: 400 }
          );
        }
      }
    }

    // `updatedProduct` is re-read via PRODUCT_COLUMNS, which does NOT embed the
    // category join or junction, so type it without `categories` /
    // `product_categories`. Those are only read from `existingProduct` for the
    // purge and are immutable across this update (neither `category_id` nor the
    // junction is writable here).
    let updatedProduct: Omit<
      typeof existingProduct,
      'categories' | 'product_categories'
    > = existingProduct;
    let hasFreshProductRow = false;
    if (Object.keys(updates).length > 1) {
      const { data: persistedProduct, error: updateError } = await supabase
        .from('products')
        .update(updates)
        .eq('id', id)
        .eq('merchant_id', merchantId)
        .select(PRODUCT_COLUMNS)
        .single();

      if (updateError) {
        console.error('Error updating product:', updateError);
        return NextResponse.json(
          { error: 'Failed to update product' },
          { status: 500 }
        );
      }

      updatedProduct = persistedProduct;
      hasFreshProductRow = true;
    }

    // Handle Variants
    if (variantsToSync !== null) {
      const { error: syncVariantsError } = await supabase.rpc(
        'sync_product_variants_for_product',
        {
          p_product_id: id,
          p_merchant_id: merchantId,
          p_variants: variantsToSync,
        }
      );

      if (syncVariantsError) {
        console.error('Error syncing product variants:', syncVariantsError);
        const isInvalidVariantReference =
          syncVariantsError.code === 'P0002' ||
          syncVariantsError.message === 'variant_not_found_or_not_owned';

        return NextResponse.json(
          {
            error: isInvalidVariantReference
              ? 'Invalid product variant update'
              : 'Failed to sync product variants',
          },
          { status: isInvalidVariantReference ? 400 : 500 }
        );
      }
    } else if (body.has_variants === false) {
      const { error: deleteVariantsError } = await supabase
        .from('product_variants')
        .delete()
        .eq('product_id', id)
        .eq('merchant_id', merchantId)
        .eq('is_inventory_anchor', false);
      if (deleteVariantsError) {
        console.error('Error deleting product variants:', deleteVariantsError);
        return NextResponse.json(
          { error: 'Failed to delete product variants' },
          { status: 500 }
        );
      }
    }

    if (deferredVariantModelUpdates) {
      const { data: variantModelProduct, error: variantModelError } =
        await supabase
          .from('products')
          .update({
            ...deferredVariantModelUpdates,
            updated_at: new Date().toISOString(),
          })
          .eq('id', id)
          .eq('merchant_id', merchantId)
          .select(PRODUCT_COLUMNS)
          .single();

      if (variantModelError) {
        console.error(
          'Error updating product variant model state:',
          variantModelError
        );
        return NextResponse.json(
          { error: 'Failed to sync product variant model' },
          { status: 500 }
        );
      }

      updatedProduct = variantModelProduct;
      hasFreshProductRow = true;
    }

    if (!hasFreshProductRow) {
      const { data: refreshedProduct, error: refreshedProductError } =
        await supabase
          .from('products')
          .select(PRODUCT_COLUMNS)
          .eq('id', id)
          .eq('merchant_id', merchantId)
          .single();

      if (refreshedProductError) {
        console.error(
          'Error refreshing updated product:',
          refreshedProductError
        );
        return NextResponse.json(
          { error: 'Failed to load updated product' },
          { status: 500 }
        );
      }

      updatedProduct = refreshedProduct;
    }

    // Regenerate embedding if name or description changed
    if (updatedProduct && (body.name || body.description)) {
      const embeddingText = getProductEmbeddingText({
        name: updatedProduct.name,
        description: updatedProduct.description,
        brand: updatedProduct.brand,
        category_name: body.category,
      });
      const serviceRoleKey = getSupabaseServiceRoleKey();

      // Fire-and-forget: Call edge function to regenerate embedding
      fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-embedding`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            type: 'product',
            id: updatedProduct.id,
            text: embeddingText,
          }),
          signal: AbortSignal.timeout(10_000),
        }
      ).catch((err) =>
        console.error('Failed to regenerate product embedding:', err)
      );
    }

    // Invalidate product caches so storefront reflects changes immediately
    revalidateProducts(merchantId, updatedProduct.slug);

    // Evict the Cloudflare-fronted public URLs the edit can change (home, the
    // product's category listing, and its PDP paths) so the raised edge TTL
    // never serves the stale page. Fire-and-forget: a purge is always
    // survivable (caches self-heal on their TTL), so it must never break the
    // update — guard the derive + schedule the same way revalidateBlogPosts
    // does.
    try {
      // Legacy rows can have a null/blank slug but are still publicly
      // addressable by id (`/products/<id>`; the PDP lookup accepts UUIDs and
      // normalizeProduct falls back to `slug || id`), so fall back to the id
      // for the purge target when the slug is missing.
      const nextSlug = updatedProduct.slug?.trim() || id;
      const previousSlug = existingProduct.slug?.trim() || id;
      // The direct join (`category_id`) and the `product_categories` junction
      // are not writable in this handler, so they are immutable across the
      // update: read them once from the OLD row and reuse for both entries. Only
      // the legacy TEXT category can change, so the NEW entry uses the fresh
      // row's text and the OLD entry uses the OLD row's text — the direct join
      // still wins, and the junction only applies when no direct join AND no
      // text are present (resolveProductPurgeCategorySegmentForRow, PR #2914).
      const immutableJoins = {
        categories: (existingProduct as { categories?: unknown }).categories,
        product_categories: (
          existingProduct as { product_categories?: unknown }
        ).product_categories,
      };
      const nextCategorySegment = resolveProductPurgeCategorySegmentForRow({
        slug: nextSlug,
        name: updatedProduct.name,
        category: (updatedProduct as { category?: string | null }).category,
        ...immutableJoins,
      });
      const productPurgeEntries: StorefrontProductPurgeEntry[] = [
        { slug: nextSlug, categorySegment: nextCategorySegment },
      ];
      const previousCategorySegment = resolveProductPurgeCategorySegmentForRow({
        slug: previousSlug,
        name: existingProduct.name,
        category: (existingProduct as { category?: string | null }).category,
        ...immutableJoins,
      });
      // A rename (slug change) OR a category move (segment change) leaves the
      // OLD canonical PDP `/<old-category>/<old-slug>` AND the OLD category
      // listing cached — derive the old entry from the OLD row's own data so
      // both get evicted (the builder emits a listing per distinct segment, so
      // pushing the old entry also purges `/<old-category>` when it differs).
      if (
        previousSlug !== nextSlug ||
        (previousCategorySegment ?? '') !== (nextCategorySegment ?? '')
      ) {
        productPurgeEntries.push({
          slug: previousSlug,
          categorySegment: previousCategorySegment,
        });
      }
      scheduleProductMutationPurge({
        supabase,
        merchantId,
        merchantSlug: merchantContext.merchantSlug,
        productIds: [updatedProduct.id],
        entries: productPurgeEntries,
      });
    } catch (purgeError) {
      console.warn('Skipped Cloudflare product purge after update', {
        purgeError,
      });
    }

    // Pre-warm the CDN image-transform cache for the product's images so the
    // first real storefront visitor never pays the cold-transform cost. Only
    // when this update actually wrote the images column — a name/price/stock-only
    // edit leaves the (already-warmed) images untouched, so re-priming them on
    // every PUT is wasted outbound fan-out.
    if (updates.images !== undefined) {
      scheduleProductImageTransformsPrewarm(
        (updatedProduct as { images?: unknown }).images
      );
    }

    return NextResponse.json({ product: updatedProduct });
  } catch (error) {
    console.error('Unexpected error in PUT /api/products/[id]:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { valid, response } = await checkCsrfProtection(request);
  if (!valid && response) return response;

  try {
    const { id } = await params;
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const merchantContext = await getMerchantForApiRequest(supabase, user.id);
    if (!merchantContext) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }
    const access = toUserAccess(merchantContext);
    if (!hasPermission(access, 'products', 'delete')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }
    const merchantId = merchantContext.merchantId;

    // Read the row's purge inputs (slug/name + legacy text `category` + the
    // `category_id` direct join + the `product_categories` junction) BEFORE the
    // delete: the junction rows are removed by ON DELETE CASCADE in the same
    // statement, so a `delete().select(...)` embed of `product_categories`
    // always comes back empty and the junction-derived canonical segment would
    // be lost. Delete is a rare admin action, so the extra read round-trip is
    // acceptable. All three category sources are read so the purge resolves the
    // same join-driven canonical the storefront served with the full PR #2914
    // precedence (active direct join → active junction → legacy text).
    const { data: productToDelete, error: preReadError } = await supabase
      .from('products')
      .select(
        'id, slug, name, category, categories:category_id(slug, is_active), product_categories(category_id, categories(slug, is_active))'
      )
      .eq('id', id)
      .eq('merchant_id', merchantId)
      .maybeSingle();

    if (!preReadError && !productToDelete) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    // Capture relationship IDs BEFORE the delete cascades join rows. Resolve
    // the published slugs after the mutation commits so the delete handler
    // does not paginate/join blog content on its critical path.
    let linkedBlogPostIds: string[] = [];
    let incompleteBlogSnapshot = false;
    try {
      const { data: linkedPosts, error: linkedPostsError } = await supabase
        .from('blog_post_products')
        .select('blog_post_id')
        .eq('merchant_id', merchantId)
        .eq('product_id', id)
        .limit(PREDELETE_BLOG_POST_ID_LIMIT + 1);
      if (linkedPostsError) throw linkedPostsError;
      incompleteBlogSnapshot =
        (linkedPosts?.length ?? 0) > PREDELETE_BLOG_POST_ID_LIMIT;
      linkedBlogPostIds = (linkedPosts ?? [])
        .map((row) => (row as { blog_post_id?: unknown }).blog_post_id)
        .filter(
          (blogPostId): blogPostId is string =>
            typeof blogPostId === 'string' && blogPostId.trim().length > 0
        )
        .map((blogPostId) => blogPostId.trim());
    } catch (linkedPostsError) {
      incompleteBlogSnapshot = true;
      console.warn('Could not snapshot linked blog post IDs before delete', {
        merchantId,
        productId: id,
        linkedPostsError,
      });
    }

    // Keep the delete itself lean — the purge inputs were pre-read above.
    const { error: deleteError } = await supabase
      .from('products')
      .delete()
      .eq('id', id)
      .eq('merchant_id', merchantId);

    if (deleteError) {
      console.error('Error deleting product:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete product' },
        { status: 500 }
      );
    }

    // Invalidate product caches after deletion
    revalidateProducts(merchantId);

    // Evict the removed product's public URLs (home, its category listing, and
    // its PDP paths) so the raised edge TTL never serves a 200 for a deleted
    // product. Fire-and-forget: a purge is always survivable (caches self-heal
    // on their TTL), so it must never break the delete — guard the derive +
    // schedule the same way revalidateBlogPosts does.
    try {
      const deletedProduct = productToDelete as {
        id?: string | null;
        slug?: string | null;
        name?: string | null;
        category?: string | null;
        categories?: unknown;
        product_categories?: unknown;
      } | null;
      if (deletedProduct) {
        // Legacy rows can have a null/blank slug but are still publicly
        // addressable by id, so fall back to the deleted row's id
        // (`/products/<id>`) when the slug is missing.
        const purgeSlug = deletedProduct.slug?.trim() || id;
        const purgeEntries: StorefrontProductPurgeEntry[] = [
          {
            slug: purgeSlug,
            categorySegment: resolveProductPurgeCategorySegmentForRow({
              slug: purgeSlug,
              name: deletedProduct.name,
              category: deletedProduct.category,
              categories: deletedProduct.categories,
              product_categories: deletedProduct.product_categories,
            }),
          },
        ];
        scheduleProductMutationPurge({
          supabase,
          merchantId,
          merchantSlug: merchantContext.merchantSlug,
          productIds: [id],
          entries: purgeEntries,
          blogPostIds: linkedBlogPostIds,
          purgeWholeStorefront: incompleteBlogSnapshot,
        });
      } else {
        // The pre-read failed, but deletion committed. Its old slug/category
        // are unknown, so evict the hostname rather than leaving canonical
        // product or cross-category article URLs cached after the cascade.
        console.warn(
          'Product purge pre-read failed after delete; scheduling complete fallback purge',
          { id, preReadError }
        );
        scheduleProductMutationPurge({
          supabase,
          merchantId,
          merchantSlug: merchantContext.merchantSlug,
          productIds: [id],
          entries: [{ slug: id, categorySegment: null }],
          blogPostIds: linkedBlogPostIds,
          purgeWholeStorefront: true,
        });
      }
    } catch (purgeError) {
      console.warn('Skipped Cloudflare product purge after delete', {
        purgeError,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Unexpected error in DELETE /api/products/[id]:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
