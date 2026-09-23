import { NextResponse } from 'next/server';
import {
  authenticateApiRequest,
  getUserAccess,
  hasPermission,
} from '@/lib/api-auth';
import {
  type QuizPrizeVariantRow,
  quizPrizeProductSearchQuerySchema,
  quizPrizeProductsResponseSchema,
} from '@/schemas/quiz-prize-product';
import {
  isProductRow,
  isVariantRow,
  mapBaseProduct,
  mapVariantProduct,
} from './prize-product-mapping';
import {
  decodePrizeProductCursor,
  paginatePrizeProducts,
} from './prize-product-pagination';

const PRODUCT_PROJECTION =
  'id, merchant_id, name, price, images, condition, default_variant_id, has_variants, manage_stock, stock, stock_quantity';
const VARIANT_PROJECTION =
  'id, merchant_id, product_id, attributes, condition, created_at, price_override, stock_quantity, primary_image, images, sku';

function prizeProductsResponse(payload: unknown) {
  const response = quizPrizeProductsResponseSchema.safeParse(payload);
  if (!response.success) {
    return NextResponse.json(
      { error: 'Failed to load prize products' },
      { status: 500 }
    );
  }
  return NextResponse.json(response.data);
}

async function loadCandidateIds(args: {
  limit: number;
  merchantId: string;
  offset: number;
  search: string;
  supabase: NonNullable<
    Awaited<ReturnType<typeof authenticateApiRequest>>['supabase']
  >;
}) {
  const { limit, merchantId, offset, search, supabase } = args;
  const lookaheadLimit = limit + 1;
  if (search) {
    const { data, error } = await supabase.rpc('search_products_v2', {
      merchant_id_param: merchantId,
      parent_only: false,
      result_limit: lookaheadLimit,
      result_offset: offset,
      search_query: search,
      sort_by: 'relevance',
      status_filter: 'active',
    });
    if (error) return { error, hasMore: false, ids: [] };
    const rows = Array.isArray(data) ? data : [];
    const ids = rows
      .map((row) =>
        row && typeof row === 'object' && 'product_id' in row
          ? String(row.product_id)
          : ''
      )
      .filter(Boolean);
    return {
      error: null,
      hasMore: ids.length > limit,
      ids,
    };
  }

  const { data, error } = await supabase
    .from('products')
    .select('id')
    .eq('merchant_id', merchantId)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    // `updated_at` can tie; keep offset/cursor pages repeatable.
    .order('id', { ascending: true })
    .range(offset, offset + limit);
  const ids = (Array.isArray(data) ? data : [])
    .map((row) => (row && typeof row.id === 'string' ? row.id : ''))
    .filter(Boolean);
  return {
    error,
    hasMore: ids.length > limit,
    ids,
  };
}

export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const access = await getUserAccess(auth.supabase);
  if (!access) {
    return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
  }
  if (!hasPermission(access, 'marketing', 'edit')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }

  const { data: merchant, error: merchantError } = await auth.supabase
    .from('merchants')
    .select('slug')
    .eq('id', access.merchantId)
    .maybeSingle();
  if (merchantError) {
    return NextResponse.json(
      { error: 'Failed to load prize products' },
      { status: 500 }
    );
  }
  const merchantSlug =
    merchant && typeof merchant.slug === 'string'
      ? merchant.slug.trim().toLowerCase()
      : null;
  if (merchantSlug !== 'ogabassey') {
    return NextResponse.json(
      { error: 'Quiz creation is only available for Ogabassey' },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  const query = quizPrizeProductSearchQuerySchema.safeParse({
    cursor: url.searchParams.get('cursor') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    offset: url.searchParams.get('offset') ?? undefined,
    search: url.searchParams.get('search') ?? undefined,
  });
  if (!query.success) {
    return NextResponse.json({ error: 'Invalid query' }, { status: 400 });
  }
  const start = query.data.cursor
    ? decodePrizeProductCursor(query.data.cursor)
    : { productOffset: query.data.offset ?? 0, variantOffset: 0 };
  const candidates = await loadCandidateIds({
    limit: query.data.limit,
    merchantId: access.merchantId,
    offset: start.productOffset,
    search: query.data.search,
    supabase: auth.supabase,
  });
  if (candidates.error) {
    return NextResponse.json(
      { error: 'Failed to load prize products' },
      { status: 500 }
    );
  }

  if (candidates.ids.length === 0) {
    return prizeProductsResponse({
      nextCursor: null,
      products: [],
      total: 0,
    });
  }

  const { data: productData, error: productError } = await auth.supabase
    .from('products')
    .select(PRODUCT_PROJECTION)
    .eq('merchant_id', access.merchantId)
    .eq('status', 'active')
    .in('id', candidates.ids);
  if (productError) {
    return NextResponse.json(
      { error: 'Failed to load prize products' },
      { status: 500 }
    );
  }
  const products = (Array.isArray(productData) ? productData : [])
    .filter(isProductRow)
    .filter((product) => product.merchant_id === access.merchantId);
  const variantProductIds = products
    .filter((product) => product.has_variants === true)
    .map((product) => product.id);
  let variants: QuizPrizeVariantRow[] = [];
  if (variantProductIds.length > 0) {
    const { data: variantData, error: variantError } = await auth.supabase
      .from('product_variants')
      .select(VARIANT_PROJECTION)
      .eq('merchant_id', access.merchantId)
      .in('product_id', variantProductIds)
      .order('created_at', { ascending: true });
    if (variantError) {
      return NextResponse.json(
        { error: 'Failed to load prize products' },
        { status: 500 }
      );
    }
    variants = (Array.isArray(variantData) ? variantData : [])
      .filter(isVariantRow)
      .filter((variant) => variant.merchant_id === access.merchantId)
      // Preserve `created_at` as the primary order and make only tied dates
      // deterministic by ID before generating a selection cursor.
      .sort(
        (left, right) =>
          (left.created_at ?? '').localeCompare(right.created_at ?? '') ||
          left.id.localeCompare(right.id)
      );
  }

  const productById = new Map(products.map((product) => [product.id, product]));
  const variantsByProduct = new Map<string, QuizPrizeVariantRow[]>();
  for (const variant of variants) {
    const current = variantsByProduct.get(variant.product_id) ?? [];
    variantsByProduct.set(variant.product_id, [...current, variant]);
  }
  const groups = candidates.ids.map((id) => {
    const product = productById.get(id);
    if (!product) return [];
    const productVariants = variantsByProduct.get(id) ?? [];
    if (product.has_variants === true && productVariants.length > 0) {
      return productVariants.map((variant) =>
        mapVariantProduct(product, variant)
      );
    }
    if (product.has_variants === true) return [];
    return [mapBaseProduct(product)];
  });
  const page = paginatePrizeProducts({
    groups,
    hasMoreCandidates: candidates.hasMore,
    limit: query.data.limit,
    start,
  });
  return prizeProductsResponse({
    nextCursor: page.nextCursor,
    products: page.products,
    total: null,
  });
}
