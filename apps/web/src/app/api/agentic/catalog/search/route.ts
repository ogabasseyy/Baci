import type { SupabaseClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { verifyAgenticRequestAccess } from '@/lib/agentic/agent-request-controls';
import { verifyAgenticApiKey } from '@/lib/agentic/auth';
import {
  type AgenticMerchantContext,
  resolveAgenticMerchantContext,
} from '@/lib/agentic/merchant-context';
import { readAgenticQueryRequest } from '@/lib/agentic/mutation-request';
import { createAgenticScopedSupabaseClient } from '@/lib/agentic/scoped-supabase';
import {
  buildUcpCatalogProductsResponse,
  filterActiveUcpCatalogProductRows,
  mapUcpCatalogProductRow,
  UCP_CATALOG_SEARCH_CAPABILITY,
  type UcpCatalogProduct,
  type UcpCatalogProductRow,
} from '@/lib/agentic/ucp-catalog-adapters';
import { buildRequestScopedStoreUrl } from '@/lib/store-url';
import { searchStorefrontProducts } from '@/lib/storefront-search';
import { createAdminClient } from '@/lib/supabase/admin';
import { ucpCatalogSearchRequestSchema } from '@/schemas/ucp-catalog-request';
import {
  applyUcpCatalogSearchFilters,
  type CatalogFilterQuery,
} from './route-filters';

const CATALOG_CURRENCY = 'NGN';
const MAX_CATALOG_SEARCH_CANDIDATES = 100;
const PRODUCT_SELECT =
  'id, merchant_id, name, description, price, images, slug, canonical_url, stock, stock_quantity, manage_stock, status, category, categories:category_id(slug, is_active), product_categories:product_categories(category_id, categories(slug, is_active)), created_at';

export async function POST(request: NextRequest) {
  if (!verifyAgenticApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const signedRequest = await readAgenticQueryRequest({ request });
  if (!signedRequest.ok) {
    return signedRequest.response;
  }
  const parsed = ucpCatalogSearchRequestSchema.safeParse(signedRequest.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const context = await resolveCatalogContext(request);
  if (!context.ok) {
    return context.response;
  }

  const limit = parsed.data.pagination?.limit ?? 20;
  const candidateLimit = MAX_CATALOG_SEARCH_CANDIDATES;
  let rankedProducts: UcpCatalogProduct[] | null = null;
  const rankedProductIds: string[] = [];
  if (parsed.data.query) {
    rankedProducts = [];
    let rankedSearchOffset = 0;
    let rankedSearchTotal = Number.POSITIVE_INFINITY;
    try {
      while (
        rankedProducts.length < limit &&
        rankedSearchOffset < rankedSearchTotal &&
        rankedSearchOffset < MAX_CATALOG_SEARCH_CANDIDATES
      ) {
        const remainingCandidateBudget =
          MAX_CATALOG_SEARCH_CANDIDATES - rankedSearchOffset;
        const requestLimit = Math.min(candidateLimit, remainingCandidateBudget);
        const ranked = await searchStorefrontProducts({
          supabase: context.supabase,
          merchantId: context.merchant.id,
          query: parsed.data.query,
          limit: requestLimit,
          offset: rankedSearchOffset,
        });
        rankedSearchTotal = ranked.count;

        if (ranked.productIds.length === 0) {
          break;
        }

        const batchProductIds = ranked.productIds
          .slice(0, requestLimit)
          .filter((id) => !rankedProductIds.includes(id));
        const batchProducts = await fetchCatalogProductsByIds({
          baseUrl: buildRequestScopedStoreUrl(
            context.merchant,
            request.headers
          ),
          currency: CATALOG_CURRENCY,
          merchantId: context.merchant.id,
          productIds: batchProductIds,
          supabase: context.supabase,
        });
        if (batchProducts.error) {
          return NextResponse.json(
            { error: 'Catalog search failed' },
            { status: 500 }
          );
        }

        rankedProductIds.push(...batchProductIds);
        rankedProducts.push(...batchProducts.products);
        rankedSearchOffset += requestLimit;
      }
    } catch (error: unknown) {
      console.error('Agentic catalog search failed:', error);
      return NextResponse.json(
        { error: 'Catalog search failed' },
        { status: 500 }
      );
    }
  }

  if (rankedProducts) {
    return NextResponse.json(
      buildUcpCatalogProductsResponse({
        capability: UCP_CATALOG_SEARCH_CAPABILITY,
        products: rankedProducts.slice(0, limit),
      })
    );
  }

  const query = applyUcpCatalogSearchFilters(
    context.supabase
      .from('products')
      .select(PRODUCT_SELECT)
      .eq('merchant_id', context.merchant.id)
      .eq('status', 'active') as unknown as CatalogFilterQuery,
    parsed.data.filters
  ).order('category_id', {
    ascending: true,
    referencedTable: 'product_categories',
  });
  const baseUrl = buildRequestScopedStoreUrl(context.merchant, request.headers);
  const orderedQuery = query
    .order('created_at', { ascending: false })
    .order('id', { ascending: true });
  const products: UcpCatalogProduct[] = [];
  let candidateOffset = 0;
  while (
    products.length < limit &&
    candidateOffset < MAX_CATALOG_SEARCH_CANDIDATES
  ) {
    const requestLimit = Math.min(
      candidateLimit,
      MAX_CATALOG_SEARCH_CANDIDATES - candidateOffset
    );
    const { data, error } = await orderedQuery.range(
      candidateOffset,
      candidateOffset + requestLimit - 1
    );
    if (error) {
      return NextResponse.json(
        { error: 'Catalog search failed' },
        { status: 500 }
      );
    }

    const batchProducts = filterActiveUcpCatalogProductRows(
      (data ?? []) as UcpCatalogProductRow[]
    )
      .map((row) =>
        mapUcpCatalogProductRow({
          baseUrl,
          currency: CATALOG_CURRENCY,
          row,
        })
      )
      .filter(
        (product): product is NonNullable<typeof product> => product !== null
      );
    products.push(...batchProducts.slice(0, limit - products.length));
    candidateOffset += requestLimit;
    if ((data ?? []).length < requestLimit) {
      break;
    }
  }

  return NextResponse.json(
    buildUcpCatalogProductsResponse({
      capability: UCP_CATALOG_SEARCH_CAPABILITY,
      products,
    })
  );
}

async function fetchCatalogProductsByIds({
  baseUrl,
  currency,
  merchantId,
  productIds,
  supabase,
}: {
  baseUrl: string;
  currency: string;
  merchantId: string;
  productIds: string[];
  supabase: SupabaseClient;
}): Promise<{ error: unknown | null; products: UcpCatalogProduct[] }> {
  if (productIds.length === 0) {
    return { error: null, products: [] };
  }

  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_SELECT)
    .eq('merchant_id', merchantId)
    .eq('status', 'active')
    .order('category_id', {
      ascending: true,
      referencedTable: 'product_categories',
    })
    .in('id', productIds)
    .limit(productIds.length);

  if (error) {
    return { error, products: [] };
  }

  const order = new Map(productIds.map((id, index) => [id, index] as const));
  const products = filterActiveUcpCatalogProductRows(
    (data ?? []) as UcpCatalogProductRow[]
  )
    .map((row) => mapUcpCatalogProductRow({ baseUrl, currency, row }))
    .filter(
      (product): product is NonNullable<typeof product> => product !== null
    )
    .sort(
      (a, b) =>
        (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.id) ?? Number.MAX_SAFE_INTEGER)
    );

  return { error: null, products };
}

async function resolveCatalogContext(
  request: NextRequest
): Promise<
  | { ok: true; merchant: AgenticMerchantContext; supabase: SupabaseClient }
  | { ok: false; response: NextResponse }
> {
  const merchant = await resolveAgenticMerchantContext(createAdminClient());
  if (!merchant) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Agentic merchant not found' },
        { status: 500 }
      ),
    };
  }
  const agentAccess = verifyAgenticRequestAccess({
    controls: {
      allowlist: merchant.agent_user_agent_allowlist ?? [],
      denylist: merchant.agent_user_agent_denylist ?? [],
    },
    headers: request.headers,
  });
  if (!agentAccess.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: agentAccess.error },
        { status: 403 }
      ),
    };
  }

  return {
    merchant,
    ok: true,
    supabase: createAgenticScopedSupabaseClient({
      merchantId: merchant.id,
      merchantSlug: merchant.slug,
    }),
  };
}
