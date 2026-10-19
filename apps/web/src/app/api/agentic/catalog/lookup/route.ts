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
  UCP_CATALOG_LOOKUP_CAPABILITY,
  type UcpCatalogProductRow,
} from '@/lib/agentic/ucp-catalog-adapters';
import { buildRequestScopedStoreUrl } from '@/lib/store-url';
import { createAdminClient } from '@/lib/supabase/admin';
import { ucpCatalogLookupRequestSchema } from '@/schemas/ucp-catalog-request';

const CATALOG_CURRENCY = 'NGN';
const PRODUCT_SELECT =
  'id, merchant_id, name, description, price, images, slug, canonical_url, stock, stock_quantity, manage_stock, status, category, categories:category_id(slug, is_active), product_categories:product_categories(category_id, categories(slug, is_active))';

export async function POST(request: NextRequest) {
  if (!verifyAgenticApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const signedRequest = await readAgenticQueryRequest({ request });
  if (!signedRequest.ok) {
    return signedRequest.response;
  }
  const parsed = ucpCatalogLookupRequestSchema.safeParse(signedRequest.body);
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

  const { data, error } = await context.supabase
    .from('products')
    .select(PRODUCT_SELECT)
    .eq('merchant_id', context.merchant.id)
    .eq('status', 'active')
    .order('category_id', {
      ascending: true,
      referencedTable: 'product_categories',
    })
    .in('id', parsed.data.ids)
    .limit(parsed.data.ids.length);
  if (error) {
    return NextResponse.json(
      { error: 'Catalog lookup failed' },
      { status: 500 }
    );
  }

  const rowsById = new Map(
    filterActiveUcpCatalogProductRows(
      (data ?? []) as UcpCatalogProductRow[]
    ).map((row) => [row.id, row])
  );
  const baseUrl = buildRequestScopedStoreUrl(context.merchant, request.headers);
  const products = parsed.data.ids
    .map((id) => rowsById.get(id))
    .filter((row): row is UcpCatalogProductRow => Boolean(row))
    .map((row) =>
      mapUcpCatalogProductRow({
        baseUrl,
        currency: CATALOG_CURRENCY,
        row,
      })
    );

  const publishableProducts = products.filter(
    (product): product is NonNullable<typeof product> => product !== null
  );

  return NextResponse.json(
    buildUcpCatalogProductsResponse({
      capability: UCP_CATALOG_LOOKUP_CAPABILITY,
      products: publishableProducts,
    })
  );
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
