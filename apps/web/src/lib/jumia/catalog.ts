/**
 * Jumia Vendor Center API — Catalog submodule
 * Products, categories, brands, attribute sets, stock
 */

import type { JumiaClient } from '@/lib/jumia/client';
import type {
  JumiaAttributeSetResponse,
  JumiaCategoriesResponse,
  JumiaCategory,
  JumiaProduct,
  JumiaStockResponse,
} from '@/schemas/jumia';
import {
  JumiaAttributeSetResponseSchema,
  JumiaBrandsResponseSchema,
  JumiaCategoriesResponseSchema,
  JumiaProductsResponseSchema,
  JumiaStockResponseSchema,
} from '@/schemas/jumia';

/** Safety limit for paginated fetches to prevent infinite loops. */
const MAX_PAGES = 1000;

// ── Products ──

export async function getProducts(
  client: JumiaClient,
  params?: {
    nextToken?: string;
    status?: string;
    shopId?: string;
  }
): Promise<{
  products: JumiaProduct[];
  nextToken: string | null;
  isLastPage: boolean;
}> {
  const query = new URLSearchParams();
  if (params?.nextToken) query.set('nextToken', params.nextToken);
  if (params?.status) query.set('status', params.status);
  if (params?.shopId) query.set('shopId', params.shopId);

  const qs = query.toString();
  const path = qs ? `/catalog/products?${qs}` : '/catalog/products';
  const response = await client.request(
    'GET',
    path,
    JumiaProductsResponseSchema
  );

  return {
    products: response.products,
    nextToken: response.nextToken,
    isLastPage: response.isLastPage,
  };
}

export async function getAllProducts(
  client: JumiaClient,
  params?: { status?: string; shopId?: string }
): Promise<JumiaProduct[]> {
  const all: JumiaProduct[] = [];
  let nextToken: string | null = null;
  let pageCount = 0;

  do {
    if (++pageCount > MAX_PAGES) {
      throw new Error(
        `getAllProducts exceeded ${MAX_PAGES} pages — aborting to prevent infinite loop`
      );
    }
    const page = await getProducts(client, {
      ...params,
      nextToken: nextToken ?? undefined,
    });
    all.push(...page.products);
    nextToken = page.nextToken;
    if (page.isLastPage) break;
    if (!nextToken) {
      throw new Error(
        'getAllProducts: API returned isLastPage=false but no nextToken — aborting to prevent data loss'
      );
    }
  } while (nextToken);

  return all;
}

// ── Categories ──

export async function getCategories(
  client: JumiaClient,
  params?: { page?: number }
): Promise<JumiaCategoriesResponse> {
  const query = new URLSearchParams();
  if (params?.page !== undefined) query.set('page', params.page.toString());

  const qs = query.toString();
  const path = qs ? `/catalog/categories?${qs}` : '/catalog/categories';
  return await client.request('GET', path, JumiaCategoriesResponseSchema);
}

export async function getAllCategories(
  client: JumiaClient
): Promise<JumiaCategory[]> {
  const all: JumiaCategory[] = [];
  let page = 1;

  while (true) {
    if (page > MAX_PAGES) {
      throw new Error(
        `getAllCategories exceeded ${MAX_PAGES} pages — aborting to prevent infinite loop`
      );
    }
    const response = await getCategories(client, { page });
    all.push(...response.categories);
    if (page >= response.page.totalOfPages) break;
    page++;
  }

  return all;
}

// ── Brands ──

export async function getBrands(
  client: JumiaClient,
  params?: { page?: number }
): Promise<{
  brands: Array<{ code: number; name: string }>;
  page: { current: number; totalOfPages: number };
}> {
  const query = new URLSearchParams();
  if (params?.page !== undefined) query.set('page', params.page.toString());

  const qs = query.toString();
  const path = qs ? `/catalog/brands?${qs}` : '/catalog/brands';
  return await client.request('GET', path, JumiaBrandsResponseSchema);
}

export async function getAllBrands(
  client: JumiaClient
): Promise<Array<{ code: number; name: string }>> {
  const all: Array<{ code: number; name: string }> = [];
  let page = 1;

  while (true) {
    if (page > MAX_PAGES) {
      throw new Error(
        `getAllBrands exceeded ${MAX_PAGES} pages — aborting to prevent infinite loop`
      );
    }
    const response = await getBrands(client, { page });
    all.push(...response.brands);
    if (page >= response.page.totalOfPages) break;
    page++;
  }

  return all;
}

// ── Attribute Sets ──

export async function getAttributeSet(
  client: JumiaClient,
  attributeSetId: string
): Promise<JumiaAttributeSetResponse> {
  const trimmedId = attributeSetId.trim();
  if (!trimmedId) {
    throw new Error('attributeSetId must be a non-empty string');
  }
  return await client.request(
    'GET',
    `/catalog/attribute-sets/${encodeURIComponent(trimmedId)}`,
    JumiaAttributeSetResponseSchema
  );
}

// ── Stock ──

export async function getStock(
  client: JumiaClient,
  params?: { nextToken?: string; sellerSku?: string }
): Promise<{
  products: JumiaStockResponse['products'];
  nextToken: string | null;
  isLastPage: boolean;
}> {
  const query = new URLSearchParams();
  if (params?.nextToken) query.set('nextToken', params.nextToken);
  if (params?.sellerSku) query.set('sellerSku', params.sellerSku);

  const qs = query.toString();
  const path = qs ? `/catalog/stock?${qs}` : '/catalog/stock';
  const response = await client.request('GET', path, JumiaStockResponseSchema);

  return {
    products: response.products,
    nextToken: response.nextToken,
    isLastPage: response.isLastPage,
  };
}

export async function getAllStock(
  client: JumiaClient,
  params?: { sellerSku?: string }
): Promise<JumiaStockResponse['products']> {
  const all: JumiaStockResponse['products'] = [];
  let nextToken: string | null = null;
  let pageCount = 0;

  do {
    if (++pageCount > MAX_PAGES) {
      throw new Error(
        `getAllStock exceeded ${MAX_PAGES} pages — aborting to prevent infinite loop`
      );
    }
    const page = await getStock(client, {
      ...params,
      nextToken: nextToken ?? undefined,
    });
    all.push(...page.products);
    nextToken = page.nextToken;
    if (page.isLastPage) break;
    if (!nextToken) {
      throw new Error(
        'getAllStock: API returned isLastPage=false but no nextToken — aborting to prevent data loss'
      );
    }
  } while (nextToken);

  return all;
}
