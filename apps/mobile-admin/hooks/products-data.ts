import {
  MOBILE_ADMIN_PRODUCT_COLUMNS as PRODUCT_COLUMNS,
  MOBILE_ADMIN_PRODUCT_COLUMNS_PUBLIC as PRODUCT_COLUMNS_PUBLIC,
} from '@baci/shared';
import { normalizeProductInventory } from '@/lib/product-inventory';
import type {
  AdminProductSearchFilters,
  AdminProductStockFilter,
} from '@/lib/product-search';
import {
  applyAdminProductStockFilter,
  fetchAdminProductSearchRows,
} from '@/lib/product-search';
import { revalidateStorefrontProducts } from '@/lib/revalidate-storefront-products';
import { supabase } from '@/lib/supabase';
import type { Product, ProductStatus, ProductsPage } from './products.types';

const PAGE_SIZE = 20;

export async function fetchProducts(
  merchantId: string,
  cursor: number = 0,
  filters?: AdminProductSearchFilters
): Promise<ProductsPage> {
  if (filters?.search) {
    const page = await fetchAdminProductSearchRows<Product>({
      cursor,
      filters,
      merchantId,
      pageSize: PAGE_SIZE,
      selectColumns: PRODUCT_COLUMNS,
    });

    return {
      nextCursor: page.nextCursor,
      products: page.rows.map((product) => normalizeProductInventory(product)),
      totalCount: page.totalCount,
    };
  }

  let query = supabase
    .from('merchant_products')
    .select(PRODUCT_COLUMNS, { count: 'exact' })
    .eq('merchant_id', merchantId)
    .is('parent_product_id', null)
    .order('created_at', { ascending: false })
    .range(cursor, cursor + PAGE_SIZE - 1);

  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.category) query = query.eq('category_id', filters.category);
  if (!filters?.status && filters?.stockFilter) {
    query = query.neq('status', 'archived');
  }
  query = applyAdminProductStockFilter(query, filters?.stockFilter);

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  const hasMore = (count ?? 0) > cursor + PAGE_SIZE;
  return {
    nextCursor: hasMore ? cursor + PAGE_SIZE : null,
    products: (data ?? []).map((product) => normalizeProductInventory(product)),
    totalCount: count ?? 0,
  };
}

const REFRESH_FAILED_ERROR =
  'Product saved, but refreshing it failed. Reload before making another change.';

async function preflightEditableProduct(productId: string, merchantId: string) {
  const { data: previousProduct, error: accessError } = await supabase
    .from('products')
    .select('id, slug, category')
    .eq('id', productId)
    .eq('merchant_id', merchantId)
    .maybeSingle();
  if (accessError || !previousProduct) {
    throw new Error(accessError?.message ?? 'Product is not accessible');
  }
  return previousProduct;
}

async function hydrateUpdatedProduct(
  productId: string,
  merchantId: string
): Promise<Product> {
  const { data, error: readError } = await supabase
    .from('merchant_products')
    .select(PRODUCT_COLUMNS)
    .eq('id', productId)
    .eq('merchant_id', merchantId)
    .maybeSingle();
  if (readError) throw new Error(REFRESH_FAILED_ERROR);
  if (data) return normalizeProductInventory(data);

  // Edit-only staff (products:edit without products:view) are excluded from
  // merchant_products; fall back to public non-cost columns on products.
  const { data: publicData, error: publicReadError } = await supabase
    .from('products')
    .select(PRODUCT_COLUMNS_PUBLIC)
    .eq('id', productId)
    .eq('merchant_id', merchantId)
    .single();
  if (publicReadError || !publicData) throw new Error(REFRESH_FAILED_ERROR);
  return normalizeProductInventory(publicData);
}

export async function updateProductStock(
  productId: string,
  stock: number,
  merchantId: string
): Promise<Product> {
  const previousProduct = await preflightEditableProduct(productId, merchantId);
  const { error } = await supabase
    .from('products')
    .update({
      stock,
      stock_quantity: stock,
      updated_at: new Date().toISOString(),
    })
    .eq('id', productId)
    .eq('merchant_id', merchantId)
    .select('id')
    .single();

  if (error) throw new Error(error.message);
  // The write committed. Invalidate even if the following hydration fails.
  void revalidateStorefrontProducts(
    [
      {
        slug: previousProduct.slug,
        id: previousProduct.id,
        category: previousProduct.category,
      },
    ],
    merchantId
  );
  return hydrateUpdatedProduct(productId, merchantId);
}

export async function updateProductStatus(
  productId: string,
  status: ProductStatus,
  merchantId: string
): Promise<Product> {
  const previousProduct = await preflightEditableProduct(productId, merchantId);
  const { error } = await supabase
    .from('products')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', productId)
    .eq('merchant_id', merchantId)
    .select('id')
    .single();

  if (error) throw new Error(error.message);
  // The write committed. Invalidate even if the following hydration fails.
  void revalidateStorefrontProducts(
    [
      {
        slug: previousProduct.slug,
        id: previousProduct.id,
        category: previousProduct.category,
      },
    ],
    merchantId
  );
  return hydrateUpdatedProduct(productId, merchantId);
}

export type { AdminProductStockFilter };
