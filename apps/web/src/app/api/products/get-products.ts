import { type NextRequest, NextResponse } from 'next/server';
import {
  getPrimaryProductImage,
  PRODUCT_IMAGE_LARGE_PLACEHOLDER_URL,
  PRODUCT_IMAGE_PLACEHOLDER_URL,
} from '@/lib/product-image';
import { PRODUCT_WITH_VARIANTS_QUERY } from '@/lib/product-queries';
import {
  getEffectiveStock,
  matchesProductStockFilter,
} from '@/lib/product-stock';
import type { Product } from '@/lib/products';
import { sanitizeLikePattern, sanitizeSearchQuery } from '@/lib/sanitize-core';
import { getProductListContext } from './get-product-list-context';
import { extractProductListVariantAttributes } from './product-list-variant-attributes';

export async function getProducts(request: NextRequest) {
  try {
    const context = await getProductListContext(request);
    if ('response' in context) return context.response;
    const { merchantId, query: queryParams, supabase } = context;
    const {
      page,
      limit,
      search: searchRaw,
      migration,
      status,
      stock,
      ids,
    } = queryParams;
    const search = searchRaw ? sanitizeSearchQuery(searchRaw) : '';
    const offset = (page - 1) * limit;
    const shouldPaginateInDatabase = !ids && stock === 'All';
    const productSelect = search.trim()
      ? `${PRODUCT_WITH_VARIANTS_QUERY}, variant_search:product_variants!product_variants_product_id_fkey()`
      : PRODUCT_WITH_VARIANTS_QUERY;

    let query = supabase
      .from('products')
      .select(productSelect as typeof PRODUCT_WITH_VARIANTS_QUERY, {
        count: 'exact',
      })
      .eq('merchant_id', merchantId)
      .order('created_at', { ascending: false });
    if (ids) {
      const idList = ids.split(',').filter(Boolean);
      if (idList.length > 0) query = query.in('id', idList);
    } else {
      if (status !== 'All') query = query.eq('status', status);
      if (migration !== 'All') {
        query =
          migration === 'pending'
            ? query.or('migration_status.eq.pending,migration_status.is.null')
            : query.eq('migration_status', migration);
      }
      if (search.trim()) {
        const sanitizedPattern = sanitizeLikePattern(search);
        const searchFilters = [
          `name.ilike.%${sanitizedPattern}%`,
          `sku.ilike.%${sanitizedPattern}%`,
          'variant_search.not.is.null',
        ];
        query = query
          .ilike('variant_search.sku', `%${sanitizedPattern}%`)
          .or(searchFilters.join(','));
      }
      if (shouldPaginateInDatabase)
        query = query.range(offset, offset + limit - 1);
    }

    const { data: products, error, count } = await query;
    if (error) {
      console.error('Error fetching products:', error);
      return NextResponse.json(
        { error: 'Failed to fetch products' },
        { status: 500 }
      );
    }

    const transformedProducts: Product[] =
      products?.map((product) => {
        const variantAttrs = product.variants?.length
          ? extractProductListVariantAttributes(product.variants)
          : { colors: [], storage_options: [], available_sizes: [] };
        const schemaRating = product.schema_markup?.aggregateRating;
        const rating =
          typeof schemaRating?.ratingValue === 'number'
            ? schemaRating.ratingValue
            : undefined;
        const review_count =
          typeof schemaRating?.reviewCount === 'number'
            ? schemaRating.reviewCount
            : undefined;
        return {
          id: product.id,
          name: product.name,
          description: product.description || '',
          status: product.status || 'draft',
          price: Number.parseFloat(product.price),
          manage_stock: product.manage_stock ?? true,
          stock: getEffectiveStock(product),
          minimum_order_quantity: 1,
          image:
            getPrimaryProductImage(product.images) ||
            PRODUCT_IMAGE_PLACEHOLDER_URL,
          imageLarge:
            getPrimaryProductImage(product.images) ||
            PRODUCT_IMAGE_LARGE_PLACEHOLDER_URL,
          imageHint: product.image_hint || '',
          images: product.images || [],
          brand: product.brand || '',
          gtin: product.gtin || '',
          mpn: product.mpn || '',
          google_product_category: product.google_product_category,
          has_variants: product.has_variants || false,
          variants:
            product.variants?.map((variant: Record<string, unknown>) => ({
              id: variant.id as string,
              product_id: variant.product_id as string,
              merchant_id: variant.merchant_id as string,
              condition: variant.condition as Product['condition'] | undefined,
              attributes: variant.attributes as Record<string, string>,
              price_override: variant.price_override as number | undefined,
              cost_price: variant.cost_price as number | undefined,
              stock_quantity: variant.stock_quantity as number,
              sku: variant.sku as string | undefined,
              primary_image: variant.primary_image as string | undefined,
              images: variant.images as string[] | undefined,
              is_inventory_anchor: variant.is_inventory_anchor as
                | boolean
                | undefined,
            })) || [],
          category: product.category || 'General',
          color: product.color,
          colors:
            variantAttrs.colors.length > 0
              ? variantAttrs.colors
              : product.color
                ? [product.color]
                : undefined,
          storage_options:
            variantAttrs.storage_options.length > 0
              ? variantAttrs.storage_options
              : undefined,
          available_sizes:
            variantAttrs.available_sizes.length > 0
              ? variantAttrs.available_sizes
              : undefined,
          rating,
          review_count,
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
        };
      }) || [];
    const filteredProducts =
      ids || stock === 'All'
        ? transformedProducts
        : transformedProducts.filter((product) =>
            matchesProductStockFilter(product, stock)
          );
    const paginatedProducts = shouldPaginateInDatabase
      ? filteredProducts
      : ids
        ? filteredProducts
        : filteredProducts.slice(offset, offset + limit);
    const totalProducts =
      ids || stock === 'All'
        ? (count ?? filteredProducts.length)
        : filteredProducts.length;

    let inventoryValue = 0;
    let outOfStockCount = 0;
    let categoryCount = 0;
    try {
      const { data: rpcStats, error: rpcError } = await supabase.rpc(
        'get_merchant_inventory_stats',
        { p_merchant_id: merchantId }
      );
      if (!rpcError && rpcStats) {
        inventoryValue = Number(rpcStats.inventoryValue || 0);
        outOfStockCount = Number(rpcStats.outOfStockCount || 0);
        categoryCount = Number(rpcStats.categoryCount || 0);
      } else {
        if (rpcError) {
          console.warn(
            'RPC get_merchant_inventory_stats failed:',
            rpcError.message
          );
        }
        const oosResult = await supabase
          .from('products')
          .select('id', { count: 'exact', head: true })
          .eq('merchant_id', merchantId)
          .eq('stock_quantity', 0);
        outOfStockCount = oosResult.count || 0;
        categoryCount = new Set(
          transformedProducts.map((product) => product.category).filter(Boolean)
        ).size;
        inventoryValue = transformedProducts.reduce(
          (sum, product) => sum + (product.price || 0) * (product.stock || 0),
          0
        );
      }
    } catch (statsErr) {
      console.error('Error fetching stats:', statsErr);
    }

    return NextResponse.json({
      products: paginatedProducts,
      pagination: {
        page,
        limit,
        total: totalProducts,
        totalPages: Math.ceil(totalProducts / limit),
      },
      stats: { inventoryValue, outOfStockCount, categoryCount },
    });
  } catch (error) {
    console.error('Unexpected error in GET /api/products:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
