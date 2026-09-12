import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { getCountryByCode } from '@/lib/countries';
import { checkCsrfProtection } from '@/lib/csrf';
import { deriveProductVariantWriteProjections } from '@/lib/derive-product-variant-projections';
import { getProductEmbeddingText } from '@/lib/embeddings';
import { getMerchantForApiRequest } from '@/lib/get-merchant-for-api-request';
import {
  getSkuMatrixValidationError,
  inferProductVariantModel,
} from '@/lib/product-variant-model';
import type { Product } from '@/lib/products';
import { sanitizeHtml } from '@/lib/sanitize';
import { sanitizeSchemaMarkup } from '@/lib/sanitize-json-ld';
import {
  generateMetaDescription,
  generateProductSchema,
  generateProductSlug,
  generateSlug,
} from '@/lib/seo-utils';
import { createClient } from '@/lib/supabase/server';
import { createProductSchema, formatZodErrors } from '@/schemas/products';
import { buildProductImagesInput } from './build-product-images-input';
import { scheduleNewProductBlogPurgeAfterResponse } from './schedule-new-product-blog-purge-after-response';
import { scheduleNewProductCaches } from './schedule-new-product-caches';

const EMBEDDING_GENERATION_TIMEOUT_MS = 10_000;

export async function createProduct(request: NextRequest) {
  try {
    const supabase = createClient(await cookies());
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { valid, response } = await checkCsrfProtection(request);
    if (!valid && response) return response;
    const parseResult = createProductSchema.safeParse(await request.json());
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: formatZodErrors(parseResult.error),
        },
        { status: 400 }
      );
    }
    const body = parseResult.data;
    const merchantContext = await getMerchantForApiRequest(supabase, user.id);
    if (!merchantContext) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }
    const merchantId = merchantContext.merchantId;
    const businessName = merchantContext.businessName ?? '';
    const { data: merchantData } = await supabase
      .from('merchants')
      .select('country')
      .eq('id', merchantId)
      .single();
    const variantModel = inferProductVariantModel({
      variantModel: body.variant_model,
      variants: body.variants,
    });
    const skuMatrixValidationError = getSkuMatrixValidationError({
      variantModel,
      hasVariants: body.has_variants,
      variants: body.variants,
    });
    if (skuMatrixValidationError) {
      return NextResponse.json(
        { error: skuMatrixValidationError },
        { status: 400 }
      );
    }
    const slug =
      body.slug ||
      generateProductSlug(body.name, body.condition, body.condition_detail);
    const sku =
      body.sku || generateSlug(body.name).toUpperCase().substring(0, 20);
    const description = body.description ? sanitizeHtml(body.description) : '';
    const meta_description =
      body.meta_description || generateMetaDescription(description);
    const meta_title = body.meta_title || body.name;
    const productForSchema: Product = {
      id: '',
      name: body.name,
      description,
      price: body.price,
      stock: body.stock ?? 0,
      manage_stock: body.manage_stock ?? true,
      status: body.status ?? 'draft',
      image: body.images?.[0]?.url || '',
      imageLarge: body.images?.[0]?.url || '',
      imageHint: body.imageHint || '',
      brand: body.brand || businessName,
      sku,
      gtin: body.gtin ?? '',
      mpn: body.mpn ?? '',
      weight_value: body.weight_value,
      weight_unit: body.weight_unit,
      condition: body.condition,
    };
    const country = merchantData?.country
      ? getCountryByCode(merchantData.country)
      : undefined;
    const schema_markup = body.schema_markup
      ? sanitizeSchemaMarkup(body.schema_markup)
      : generateProductSchema(
          productForSchema,
          businessName,
          country?.currency || 'USD'
        );
    const resolvedImages = buildProductImagesInput(
      body.images,
      body.image ?? body.imageLarge,
      body.name
    );
    const variantWriteProjections = deriveProductVariantWriteProjections({
      fallbackColor: body.color,
      hasVariants: body.has_variants || false,
      productImages: resolvedImages,
      variants: body.variants,
    });
    const { data: existingProduct } = await supabase
      .from('products')
      .select('id')
      .eq('merchant_id', merchantId)
      .eq('slug', slug)
      .maybeSingle();
    if (existingProduct) {
      return NextResponse.json(
        { error: 'A product with this name already exists.' },
        { status: 409 }
      );
    }
    const { data: product, error: productError } = await supabase
      .from('products')
      .insert({
        merchant_id: merchantId,
        name: body.name,
        description,
        price: body.price,
        stock: body.stock ?? 0,
        stock_quantity: body.stock ?? 0,
        manage_stock: body.manage_stock ?? true,
        sku,
        slug,
        compare_at_price: body.compare_at_price,
        cost_price: body.cost_price,
        low_stock_threshold: body.low_stock_threshold ?? 5,
        images: resolvedImages,
        image_hint: body.imageHint,
        weight_value: body.weight_value,
        weight_unit: body.weight_unit,
        dimensions: body.dimensions,
        status: body.status || 'draft',
        taxable: body.taxable ?? true,
        tax_code: body.tax_code,
        condition: body.condition || 'new',
        condition_detail: body.condition_detail,
        meta_title,
        meta_description,
        keywords: body.keywords,
        canonical_url: body.canonical_url,
        schema_markup,
        gtin: body.gtin,
        mpn: body.mpn,
        google_product_category: body.google_product_category,
        brand: body.brand,
        fulfillment_details: body.fulfillment_details,
        has_variants: body.has_variants || false,
        variant_model: variantModel,
        migration_status:
          variantModel === 'sku_matrix' ? 'migrated' : 'pending',
        category: body.category,
        color: (variantWriteProjections.color ?? body.color?.trim()) || null,
      })
      .select('id')
      .single();
    if (productError) {
      console.error('Error creating product:', productError);
      return NextResponse.json(
        { error: 'Failed to create product', details: productError.message },
        { status: 500 }
      );
    }
    if (body.has_variants && body.variants && body.variants.length > 0) {
      const variantsToInsert = body.variants.map(
        (variant: Record<string, unknown>) => ({
          product_id: product.id,
          merchant_id: merchantId,
          condition: variant.condition,
          attributes: variant.attributes,
          price_override: variant.price_override,
          cost_price: variant.cost_price,
          stock_quantity: variant.stock_quantity,
          sku: variant.sku,
          primary_image: variant.primary_image,
          images: variant.images || [],
        })
      );
      const { error: variantsError } = await supabase
        .from('product_variants')
        .insert(variantsToInsert);
      if (variantsError) {
        console.error('Error creating variants:', variantsError, {
          productId: product?.id,
          variantCount: variantsToInsert.length,
        });
        const { error: rollbackError } = await supabase
          .from('products')
          .delete()
          .eq('id', product.id)
          .eq('merchant_id', merchantId);
        if (rollbackError) {
          console.error(
            'Failed to roll back orphaned product after variant insert failure:',
            {
              productId: product.id,
              variantsError,
              rollbackError,
            }
          );
        }
        return NextResponse.json(
          {
            error: 'Failed to create product variants',
            details: variantsError.message,
            productId: product?.id,
            rolledBack: !rollbackError,
          },
          { status: 500 }
        );
      }
    }
    if (product?.id) {
      const embeddingAbortController = new AbortController();
      const embeddingTimeout = setTimeout(
        () => embeddingAbortController.abort(),
        EMBEDDING_GENERATION_TIMEOUT_MS
      );
      const embeddingText = getProductEmbeddingText({
        name: body.name,
        description,
        brand: body.brand,
        category_name: body.category,
      });
      void supabase.functions
        .invoke('generate-embedding', {
          body: {
            id: product.id,
            text: embeddingText,
            type: 'product',
          },
          signal: embeddingAbortController.signal,
        })
        .then(({ error }) => {
          if (error)
            console.error('Failed to generate product embedding:', error);
        })
        .catch((error) =>
          console.error('Failed to generate product embedding:', error)
        )
        .finally(() => clearTimeout(embeddingTimeout));
    }
    scheduleNewProductCaches({
      merchantId,
      merchantSlug: merchantContext.merchantSlug,
      productId: product.id,
      slug,
      name: body.name,
      category: body.category,
      images: resolvedImages,
    });
    if (body.status === 'active')
      scheduleNewProductBlogPurgeAfterResponse({
        category: body.category,
        merchantId,
        merchantSlug: merchantContext.merchantSlug,
        name: body.name,
        productId: product.id,
        slug,
        status: body.status,
        supabase,
      });
    return NextResponse.json({ product }, { status: 201 });
  } catch (error) {
    console.error('Unexpected error in POST /api/products:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
