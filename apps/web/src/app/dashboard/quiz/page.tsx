import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  expandPrizeProduct,
  isProductRow,
  isVariantRow,
} from '@/app/api/merchant/quiz/prize-products/prize-product-mapping';
import { paginatePrizeProducts } from '@/app/api/merchant/quiz/prize-products/prize-product-pagination';
import {
  PRODUCT_PROJECTION,
  VARIANT_PROJECTION,
} from '@/app/api/merchant/quiz/prize-products/prize-product-projections';
import {
  ensurePermission,
  isMerchantPermissionRedirectError,
} from '@/lib/merchant-server';
import { createClient } from '@/lib/supabase/server';
import {
  type QuizPrizeVariantRow,
  quizPrizeProductSchema,
  quizPrizeProductsResponseSchema,
} from '@/schemas/quiz-prize-product';
import { QuizAdminClient } from './quiz-admin-client';

export const metadata: Metadata = {
  title: 'Quiz | Baci Dashboard',
  description: 'Generate merchant quiz topics and questions with Gemma',
};

const INITIAL_PRIZE_PRODUCT_LIMIT = 100;

export async function loadPrizeProducts(merchantId: string) {
  const supabase = createClient(await cookies());
  const { count, data, error } = await supabase
    .from('products')
    .select(PRODUCT_PROJECTION, { count: 'exact' })
    .eq('merchant_id', merchantId)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    // Match the API candidate order so continuation cursors resume coherently.
    .order('id', { ascending: true })
    .limit(INITIAL_PRIZE_PRODUCT_LIMIT);

  if (error) {
    return {
      error: 'Failed to load prize products',
      nextCursor: null,
      products: [],
      total: null,
    };
  }

  const candidates = Array.isArray(data) ? data : [];
  const rows = candidates
    .filter(isProductRow)
    .filter((row) => row.merchant_id === merchantId);
  // Mirror the prize API: expand variant parents into selectable variant rows
  // and omit parents with no concrete variant inventory, so the initial page
  // never shows the unselectable parents that searches omit.
  const variantParentIds = rows
    .filter((row) => row.has_variants === true)
    .map((row) => row.id);
  const variantsByProduct = new Map<string, QuizPrizeVariantRow[]>();
  if (variantParentIds.length > 0) {
    const { data: variantData, error: variantError } = await supabase
      .from('product_variants')
      .select(VARIANT_PROJECTION)
      .eq('merchant_id', merchantId)
      .in('product_id', variantParentIds)
      .order('created_at', { ascending: true });
    if (variantError) {
      return {
        error: 'Failed to load prize products',
        nextCursor: null,
        products: [],
        total: null,
      };
    }
    for (const variant of (Array.isArray(variantData) ? variantData : [])
      .filter(isVariantRow)
      .filter((row) => row.merchant_id === merchantId)) {
      const current = variantsByProduct.get(variant.product_id) ?? [];
      variantsByProduct.set(variant.product_id, [...current, variant]);
    }
  }
  // Expansion multiplies rows: one parent can carry a large variant matrix.
  // Paginate at the expanded-row boundary with the shared helper so a
  // truncated page carries the variant offset instead of dropping variants
  // that normal pagination could never reach. Dropped rows keep empty groups
  // so group positions stay aligned with candidate offsets, like the API.
  const groups = candidates.map((item) => {
    if (!isProductRow(item) || item.merchant_id !== merchantId) return [];
    return expandPrizeProduct(
      item,
      variantsByProduct.get(item.id) ?? []
    ).flatMap((product) => {
      const parsed = quizPrizeProductSchema.safeParse(product);
      return parsed.success ? [parsed.data] : [];
    });
  });
  const total = typeof count === 'number' && count >= 0 ? count : null;
  const page = paginatePrizeProducts({
    groups,
    hasMoreCandidates: total !== null && total > candidates.length,
    limit: INITIAL_PRIZE_PRODUCT_LIMIT,
    start: { productOffset: 0, variantOffset: 0 },
  });

  const response = quizPrizeProductsResponseSchema.safeParse({
    nextCursor: page.nextCursor,
    products: page.products,
    total,
  });
  if (!response.success) {
    return {
      error: 'Failed to load prize products',
      nextCursor: null,
      products: [],
      total: null,
    };
  }

  return { error: null, ...response.data };
}

export default async function QuizDashboardPage() {
  let permissionContext: Awaited<ReturnType<typeof ensurePermission>>;
  try {
    permissionContext = await ensurePermission('marketing', 'edit');
  } catch (error) {
    if (!isMerchantPermissionRedirectError(error)) {
      throw error;
    }
    redirect('/dashboard');
  }

  if (permissionContext.merchant.slug?.trim().toLowerCase() !== 'ogabassey') {
    redirect('/dashboard');
  }

  const prizeProductResult = await loadPrizeProducts(
    permissionContext.merchant.id
  );

  return (
    <QuizAdminClient
      initialPrizeProducts={prizeProductResult.products}
      initialPrizeProductsError={prizeProductResult.error}
    />
  );
}
