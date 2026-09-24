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
  type QuizPrizeProduct,
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
  // Mirror the prize API: expand variant parents into selectable variant rows
  // and omit parents with no concrete variant inventory, so the initial page
  // never shows the unselectable parents that searches omit. Hydrate one
  // parent at a time, fetching at most the rows still needed to fill the
  // page, so a large variant matrix cannot make this SSR request download
  // unbounded inventory; the paginator's cursor resumes where hydration
  // stopped. Dropped rows keep empty groups so group positions stay aligned
  // with candidate offsets, like the API.
  const groups: QuizPrizeProduct[][] = [];
  let expandedCount = 0;
  for (const item of candidates) {
    if (expandedCount >= INITIAL_PRIZE_PRODUCT_LIMIT) break;
    if (!isProductRow(item) || item.merchant_id !== merchantId) {
      groups.push([]);
      continue;
    }
    let variants: QuizPrizeVariantRow[] = [];
    if (item.has_variants === true) {
      // Lookahead row (+1): fetching one row past the fill point proves
      // whether the parent still has variants, so the paginator can emit a
      // mid-group continuation cursor instead of wrongly ending the page.
      const { data: variantData, error: variantError } = await supabase
        .from('product_variants')
        .select(VARIANT_PROJECTION)
        .eq('merchant_id', merchantId)
        .eq('product_id', item.id)
        .order('created_at', { ascending: true })
        .limit(INITIAL_PRIZE_PRODUCT_LIMIT - expandedCount + 1);
      if (variantError) {
        return {
          error: 'Failed to load prize products',
          nextCursor: null,
          products: [],
          total: null,
        };
      }
      variants = (Array.isArray(variantData) ? variantData : [])
        .filter(isVariantRow)
        .filter((row) => row.merchant_id === merchantId);
    }
    const expanded = expandPrizeProduct(item, variants).flatMap((product) => {
      const parsed = quizPrizeProductSchema.safeParse(product);
      return parsed.success ? [parsed.data] : [];
    });
    groups.push(expanded);
    expandedCount += expanded.length;
  }
  const total = typeof count === 'number' && count >= 0 ? count : null;
  const page = paginatePrizeProducts({
    groups,
    hasMoreCandidates: total !== null && total > groups.length,
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
      initialNextCursor={prizeProductResult.nextCursor}
      initialPrizeProducts={prizeProductResult.products}
      initialPrizeProductsError={prizeProductResult.error}
    />
  );
}
