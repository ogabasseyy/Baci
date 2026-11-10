import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getPrimaryProductImage,
  PRODUCT_IMAGE_LARGE_PLACEHOLDER_URL,
  PRODUCT_IMAGE_PLACEHOLDER_URL,
} from '@/lib/product-image';
import {
  DEFAULT_PRODUCT_LIST_FILTERS,
  type MigrationFilterValue,
  type ProductListFilters,
  type StatusFilterValue,
  type StockFilterValue,
} from '@/lib/product-list-filters';
import { PRODUCT_WITH_VARIANTS_QUERY } from '@/lib/product-queries';
import {
  getEffectiveStock,
  matchesProductStockFilter,
} from '@/lib/product-stock';
import type { Product } from '@/lib/products';
import { sanitizeLikePattern, sanitizeSearchQuery } from '@/lib/sanitize-core';

/**
 * Extract denormalized variant attributes for fast UI rendering
 */
function extractVariantAttributes(variants: Record<string, unknown>[]): {
  colors: string[];
  storage_options: string[];
  available_sizes: string[];
} {
  const colors = new Set<string>();
  const storage = new Set<string>();
  const sizes = new Set<string>();

  for (const v of variants) {
    const attrs = v.attributes as Record<string, string> | undefined;
    if (attrs?.color) colors.add(attrs.color);
    if (attrs?.storage) storage.add(attrs.storage);
    if (attrs?.size) sizes.add(attrs.size);
  }

  return {
    colors: [...colors],
    storage_options: [...storage],
    available_sizes: [...sizes],
  };
}

export interface GetProductsParams {
  migration?: MigrationFilterValue;
  page?: number;
  limit?: number;
  search?: string;
  status?: StatusFilterValue;
  stock?: StockFilterValue;
}

export interface ProductsResult {
  products: Product[];
  filters: ProductListFilters;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  stats: {
    inventoryValue: number;
    outOfStockCount: number;
    categoryCount: number;
  };
}

export async function getProducts(
  supabase: SupabaseClient,
  merchantId: string,
  params: GetProductsParams
): Promise<ProductsResult> {
  const {
    migration = DEFAULT_PRODUCT_LIST_FILTERS.migration,
    page = 1,
    limit = 10,
    search: searchRaw = DEFAULT_PRODUCT_LIST_FILTERS.search,
    status = DEFAULT_PRODUCT_LIST_FILTERS.status,
    stock = DEFAULT_PRODUCT_LIST_FILTERS.stock,
  } = params;

  // Sanitize search input
  const search = searchRaw ? sanitizeSearchQuery(searchRaw) : '';
  const offset = (page - 1) * limit;
  const shouldPaginateInDatabase = stock === 'All';

  // Build query
  let query = supabase
    .from('merchant_products')
    .select(PRODUCT_WITH_VARIANTS_QUERY, { count: 'exact' })
    .eq('merchant_id', merchantId)
    .order('created_at', { ascending: false });

  // Apply filters
  if (status !== 'All') {
    query = query.eq('status', status);
  }

  if (migration !== 'All') {
    query =
      migration === 'pending'
        ? query.or('migration_status.eq.pending,migration_status.is.null')
        : query.eq('migration_status', migration);
  }

  if (search?.trim()) {
    const sanitizedPattern = sanitizeLikePattern(search);
    query = query.or(
      `name.ilike.%${sanitizedPattern}%,sku.ilike.%${sanitizedPattern}%,description.ilike.%${sanitizedPattern}%`
    );
  }

  if (shouldPaginateInDatabase) {
    query = query.range(offset, offset + limit - 1);
  }

  const { data: productsData, error, count } = await query;

  if (error) {
    console.error('Error fetching products:', error);
    throw new Error('Failed to fetch products');
  }

  // Transform to match UI Product interface
  const transformedProducts: Product[] =
    productsData?.map((p) => {
      // Extract denormalized attributes
      const variantAttrs = p.variants?.length
        ? extractVariantAttributes(p.variants)
        : { colors: [], storage_options: [], available_sizes: [] };

      // Extract rating from schema_markup if available
      const schemaRating = p.schema_markup?.aggregateRating;
      const rating =
        typeof schemaRating?.ratingValue === 'number'
          ? schemaRating.ratingValue
          : undefined;
      const review_count =
        typeof schemaRating?.reviewCount === 'number'
          ? schemaRating.reviewCount
          : undefined;

      const primary = getPrimaryProductImage(p.images);
      return {
        id: p.id,
        name: p.name,
        description: p.description || '',
        status: p.status || 'draft',
        price: Number.parseFloat(p.price),
        manage_stock: p.manage_stock ?? false,
        stock: getEffectiveStock(p),
        minimum_order_quantity: 1,

        // Image handling
        image: primary || PRODUCT_IMAGE_PLACEHOLDER_URL,
        imageLarge: primary || PRODUCT_IMAGE_LARGE_PLACEHOLDER_URL,
        imageHint: p.image_hint || '',
        images: p.images || [],

        brand: p.brand || '',
        gtin: p.gtin || '',
        mpn: p.mpn || '',
        google_product_category: p.google_product_category,

        has_variants: p.has_variants || false,
        variants:
          p.variants?.map((v: Record<string, unknown>) => ({
            id: v.id as string,
            product_id: v.product_id as string,
            merchant_id: v.merchant_id as string,
            condition: v.condition as Product['condition'] | undefined,
            attributes: v.attributes as Record<string, string>,
            price_override:
              v.price_override == null ? undefined : Number(v.price_override),
            cost_price: v.cost_price == null ? undefined : Number(v.cost_price),
            stock_quantity: Number(v.stock_quantity || 0),
            sku: v.sku as string | undefined,
            primary_image: v.primary_image as string | undefined,
            images: v.images as string[] | undefined,
          })) || [],
        category: p.category || 'General',
        color: p.color,

        // Denormalized fields for fast UI rendering
        colors:
          variantAttrs.colors.length > 0
            ? variantAttrs.colors
            : p.color
              ? [p.color]
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

        // Other fields
        sku: p.sku,
        slug: p.slug,
        compare_at_price:
          p.compare_at_price == null
            ? undefined
            : Number.parseFloat(p.compare_at_price),
        cost_price:
          p.cost_price == null ? undefined : Number.parseFloat(p.cost_price),
        low_stock_threshold: p.low_stock_threshold,
        variant_model:
          p.variant_model === 'sku_matrix' ? 'sku_matrix' : 'legacy',
        migration_status:
          p.migration_status === 'needs_review' ||
          p.migration_status === 'migrated'
            ? p.migration_status
            : 'pending',
        default_variant_id:
          typeof p.default_variant_id === 'string'
            ? p.default_variant_id
            : undefined,
        available_conditions: Array.isArray(p.available_conditions)
          ? (p.available_conditions as Product['available_conditions'])
          : undefined,
        min_variant_price:
          p.min_variant_price != null
            ? Number.parseFloat(String(p.min_variant_price))
            : undefined,
        max_variant_price:
          p.max_variant_price != null
            ? Number.parseFloat(String(p.max_variant_price))
            : undefined,

        weight_value: p.weight_value
          ? Number.parseFloat(p.weight_value)
          : undefined,
        weight_unit: p.weight_unit,
        dimensions: p.dimensions,

        taxable: p.taxable,
        tax_code: p.tax_code,

        condition: p.condition,
        condition_detail: p.condition_detail,

        meta_title: p.meta_title,
        meta_description: p.meta_description,
        keywords: p.keywords,
        canonical_url: p.canonical_url,
        schema_markup: p.schema_markup,
      };
    }) || [];

  const filteredProducts =
    stock === 'All'
      ? transformedProducts
      : transformedProducts.filter((product) =>
          matchesProductStockFilter(product, stock)
        );
  const paginatedProducts = shouldPaginateInDatabase
    ? filteredProducts
    : filteredProducts.slice(offset, offset + limit);
  const totalProducts =
    stock === 'All'
      ? (count ?? filteredProducts.length)
      : filteredProducts.length;

  // OPTIMIZED: Use database RPC instead of fetching all products
  let inventoryValue = 0;
  let outOfStockCount = 0;
  let categoryCount = 0;

  // Define RPC response type
  interface MerchantInventoryStats {
    inventoryValue: number;
    outOfStockCount: number;
    categoryCount: number;
  }

  try {
    const { data: rpcStats, error: rpcError } = await supabase.rpc(
      'get_merchant_inventory_stats',
      { p_merchant_id: merchantId }
    );

    if (!rpcError && rpcStats) {
      const stats = rpcStats as unknown as MerchantInventoryStats;
      inventoryValue = Number(stats.inventoryValue || 0);
      outOfStockCount = Number(stats.outOfStockCount || 0);
      categoryCount = Number(stats.categoryCount || 0);
    }
  } catch (statsErr) {
    console.error('Error fetching inventory stats:', statsErr);
    // Continue with zeros - stats are not critical
  }

  return {
    products: paginatedProducts,
    filters: {
      migration,
      status,
      stock,
      search,
    },
    pagination: {
      page,
      limit,
      total: totalProducts,
      totalPages: Math.ceil(totalProducts / limit),
    },
    stats: {
      inventoryValue,
      outOfStockCount,
      categoryCount,
    },
  };
}

export async function getCategories(
  supabase: SupabaseClient,
  merchantId: string
): Promise<{ name: string; count: number }[]> {
  const { data } = await supabase
    .from('products')
    .select('category')
    .eq('merchant_id', merchantId);

  const categoryMap = new Map<string, number>();
  data?.forEach((p) => {
    // Handle potentially null or empty categories
    const cat = p.category;
    if (cat && typeof cat === 'string') {
      categoryMap.set(cat, (categoryMap.get(cat) || 0) + 1);
    }
  });

  return Array.from(categoryMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count); // Sort by count desc
}
