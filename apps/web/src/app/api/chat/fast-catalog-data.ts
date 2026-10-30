import { CHAT_PRODUCT_PROJECTION } from '@/ai/chat-product-projection';
import {
  type ChatProductResult,
  createChatProductResult,
} from '@/ai/chat-product-result';
import { resolveSerializedAnchorStock } from '@/lib/serialized-anchor-stock';
import { searchStorefrontProducts } from '@/lib/storefront-search';
import { createPublicClient } from '@/lib/supabase/public';
import {
  fastCatalogProductRowSchema,
  fastCatalogVariantRowSchema,
} from '@/schemas/fast-catalog';
import {
  type FastCatalogVariant,
  selectFastCatalogProducts,
} from './fast-catalog-eligibility';
import type {
  FastCatalogCategory,
  FastCatalogIntent,
} from './fast-catalog-intent';
import {
  catalogMatchesModel,
  catalogSearchQueries,
  catalogSymbolModelLookup,
} from './fast-catalog-model';
import { isWifiOnlyConnectivity } from './fast-catalog-wifi';

type SearchIntent = Extract<FastCatalogIntent, { kind: 'search' }>;

function catalogMatchesPreference(specs: unknown, preference: string): boolean {
  const record = Array.isArray(specs) ? specs[0] : specs;
  if (!record || typeof record !== 'object' || !('recommended_for' in record))
    return false;
  const recommendations = record.recommended_for;
  if (!Array.isArray(recommendations)) return false;
  const matchers: Record<string, RegExp> = {
    gaming: /\b(?:gaming|gamers?)\b/i,
    camera: /\b(?:cameras?|photograph\w*|photos?)\b/i,
    battery: /\bbattery\b/i,
  };
  const matcher = matchers[preference];
  return (
    !!matcher &&
    recommendations.some(
      (item) =>
        typeof item === 'string' &&
        !/\b(?:not|no|never|without|avoid|unsuitable|non)\b/i.test(item) &&
        matcher.test(item)
    )
  );
}

function catalogHasWirelessEarbudEvidence(
  name: string,
  description: string | null
): boolean {
  const text = `${name} ${description ?? ''}`;
  const wirelessEarbuds =
    /\b(?:true\s+)?(?:wireless|bluetooth)\s+(?:(?:in[\s-]*ear|stereo)\s+)?(?:earbuds?|earphones?)\b/i;
  const negated =
    /\b(?:(?:not|no|never|without)\s+|non[\s-]*)(?:true\s+)?(?:wireless|bluetooth)\s+(?:(?:in[\s-]*ear|stereo)\s+)?(?:earbuds?|earphones?)\b/i;
  return wirelessEarbuds.test(text) && !negated.test(text);
}

function catalogNamesPhoneAccessory(name: string): boolean {
  return /\b(?:phones?|smartphones?|iphone|pixel\s*\d+|galaxy\s+(?:[samf]\s*\d+|z\s*(?:fold|flip)\s*\d+))\b/i.test(
    name
  );
}

export async function loadFastCatalogProducts(
  merchantId: string,
  intent: SearchIntent
): Promise<ChatProductResult[]> {
  if (!intent.categoryId && !intent.phoneCategoryIds?.length) {
    throw new Error('Phone category unavailable');
  }
  const supabase = createPublicClient({
    clientInfo: 'baci-fast-chat-catalog',
    timeoutMs: 3000,
  });
  const searchQueries = catalogSearchQueries(intent.query);
  const symbolModel = intent.categoryId
    ? catalogSymbolModelLookup(intent.query)
    : null;
  const symbolLookup =
    symbolModel && intent.categoryId
      ? (() => {
          let lookup = supabase
            .from('products')
            .select('id')
            .eq('merchant_id', merchantId)
            .eq('status', 'active')
            .eq('category_id', intent.categoryId)
            .ilike('name', `%${symbolModel.symbol}+%`);
          if (symbolModel.anchor)
            lookup = lookup.ilike('name', `%${symbolModel.anchor}%`);
          return lookup
            .order('view_count', { ascending: false, nullsFirst: false })
            .order('id', { ascending: true })
            .limit(50);
        })()
      : null;
  const [rankings, symbolResult] = await Promise.all([
    Promise.all(
      searchQueries.map((query) =>
        searchStorefrontProducts({
          supabase,
          merchantId,
          query,
          filters: { categoryId: intent.categoryId },
          limit: 50,
          includeDidYouMean: false,
        })
      )
    ),
    symbolLookup,
  ]);
  if (symbolResult && (symbolResult.error || !Array.isArray(symbolResult.data)))
    throw new Error('Catalog symbol lookup unavailable');
  const symbolIds = (symbolResult?.data ?? []).flatMap((row) =>
    typeof row.id === 'string' && row.id ? [row.id] : []
  );
  const ranked = searchQueries.length
    ? {
        productIds: [
          ...new Set([
            ...(rankings[0]?.productIds.slice(0, 50) ?? []),
            ...symbolIds,
            ...rankings
              .slice(1)
              .flatMap((result) => result.productIds.slice(0, 50)),
          ]),
        ].slice(0, 100),
      }
    : null;
  if (ranked && ranked.productIds.length === 0) return [];

  let query = supabase
    .from('products')
    .select(
      `${CHAT_PRODUCT_PROJECTION},merchant_id,category_id,product_key_specs(recommended_for,sim_type)`
    )
    .eq('merchant_id', merchantId)
    .eq('status', 'active')
    .order('view_count', { ascending: false, nullsFirst: false });
  if (intent.categoryId) query = query.eq('category_id', intent.categoryId);
  if (ranked) query = query.in('id', ranked.productIds);
  const { data, error } = await query.limit(
    ranked ? ranked.productIds.length : 200
  );
  if (error) throw new Error('Catalog unavailable');
  const rankedIds = ranked ? new Set(ranked.productIds) : null;
  const parsedRows = (data ?? []).flatMap((row) => {
    const parsed = fastCatalogProductRowSchema.safeParse(row);
    return parsed.success
      ? [
          {
            ...parsed.data,
            manage_stock: parsed.data.manage_stock ?? true,
            has_variants: parsed.data.has_variants ?? false,
            has_condition_offers: parsed.data.has_condition_offers ?? false,
            variant_model: parsed.data.variant_model ?? 'legacy',
          },
        ]
      : [];
  });
  if ((data?.length ?? 0) > 0 && parsedRows.length === 0)
    throw new Error('Catalog response invalid');
  const rows = parsedRows.filter(
    (row) =>
      row.merchant_id === merchantId &&
      (!intent.categoryId || row.category_id === intent.categoryId) &&
      row.status === 'active' &&
      (!intent.phoneProtectiveAccessory ||
        catalogNamesPhoneAccessory(row.name)) &&
      (!intent.wirelessEarbudsOnly ||
        catalogHasWirelessEarbudEvidence(row.name, row.description)) &&
      (!rankedIds ||
        (rankedIds.has(row.id) &&
          catalogMatchesModel(intent.query, row.name, row.brand))) &&
      (!intent.preference ||
        catalogMatchesPreference(row.product_key_specs, intent.preference))
  );
  const variantIds = rows
    .filter(
      (product) =>
        product.has_variants || product.variant_model === 'sku_matrix'
    )
    .map((product) => product.id);
  const variantIdSet = new Set(variantIds);
  const simpleIds = rows
    .filter((product) => !variantIdSet.has(product.id))
    .map((product) => product.id);
  const anchorBatches = [];
  for (let index = 0; index < simpleIds.length; index += 100) {
    anchorBatches.push(simpleIds.slice(index, index + 100));
  }
  const [anchorResults, variantResult] = await Promise.all([
    Promise.all(
      anchorBatches.map((productIds) =>
        resolveSerializedAnchorStock({ supabase, merchantId, productIds })
      )
    ),
    variantIds.length
      ? supabase.rpc('get_storefront_product_variants', {
          p_product_ids: variantIds,
        })
      : null,
  ]);
  if (anchorResults.some((result) => result.failed))
    throw new Error('Catalog availability unavailable');
  const anchors = new Map(
    anchorResults.flatMap((result) => [...result.projections])
  );
  const products = rows.map((row) => {
    if (variantIdSet.has(row.id)) return createChatProductResult(row);
    const anchor = anchors.get(row.id.toLowerCase());
    // Cart-link transfer and order creation enforce stock_quantity. A missing
    // or zero scalar must not make a managed product look purchasable.
    const stock = anchor?.stockQuantity ?? row.stock_quantity ?? 0;
    return createChatProductResult({
      ...row,
      manage_stock: anchor?.manageStock ?? row.manage_stock,
      stock,
      stock_quantity: stock,
    });
  });
  if (ranked) {
    const order = new Map(ranked.productIds.map((id, index) => [id, index]));
    products.sort((a, b) => (order.get(a.id) ?? 50) - (order.get(b.id) ?? 50));
  }
  let variants: FastCatalogVariant[] = [];
  if (variantResult) {
    if (variantResult.error || !Array.isArray(variantResult.data))
      throw new Error('Catalog options unavailable');
    variants = variantResult.data.flatMap((row) => {
      const parsed = fastCatalogVariantRowSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    });
    if (variantResult.data.length > 0 && variants.length === 0)
      throw new Error('Catalog options invalid');
  }
  const phoneProductIds = new Set(
    rows
      .filter((row) => intent.phoneCategoryIds?.includes(row.category_id ?? ''))
      .map((row) => row.id)
  );
  const parentWifiOnlyIds = new Set(
    rows
      .filter((row) => {
        const specs = Array.isArray(row.product_key_specs)
          ? row.product_key_specs[0]
          : row.product_key_specs;
        return (
          !!specs &&
          typeof specs === 'object' &&
          isWifiOnlyConnectivity(specs as Record<string, unknown>)
        );
      })
      .map((row) => row.id)
  );
  return selectFastCatalogProducts(products, variants, {
    ...intent,
    phoneProductIds,
    parentWifiOnlyIds,
  }).slice(0, 6);
}

export async function loadFastCatalogCategories(
  merchantId: string
): Promise<FastCatalogCategory[]> {
  const supabase = createPublicClient({
    clientInfo: 'baci-fast-chat-categories',
    timeoutMs: 3000,
  });
  const { data, error } = await supabase
    .from('categories')
    .select('id,name,slug,is_active,merchant_id')
    .eq('merchant_id', merchantId)
    .order('name', { ascending: true })
    .limit(200);
  if (error) throw new Error('Catalog categories unavailable');
  return (data ?? []).flatMap((row) =>
    row.merchant_id === merchantId &&
    row.is_active !== false &&
    typeof row.id === 'string' &&
    typeof row.name === 'string' &&
    typeof row.slug === 'string'
      ? [{ id: row.id, name: row.name, slug: row.slug }]
      : []
  );
}
