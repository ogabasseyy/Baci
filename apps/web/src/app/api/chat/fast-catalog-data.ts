import z from 'zod';
import { CHAT_PRODUCT_PROJECTION } from '@/ai/chat-product-projection';
import {
  type ChatProductResult,
  createChatProductResult,
} from '@/ai/chat-product-result';
import { resolveSerializedAnchorStock } from '@/lib/serialized-anchor-stock';
import { searchStorefrontProducts } from '@/lib/storefront-search';
import { createPublicClient } from '@/lib/supabase/public';
import {
  type FastCatalogVariant,
  selectFastCatalogProducts,
} from './fast-catalog-eligibility';
import {
  type FastCatalogCategory,
  type FastCatalogIntent,
  normalizeAccessoryNouns,
} from './fast-catalog-intent';

type SearchIntent = Extract<FastCatalogIntent, { kind: 'search' }>;

const productRowSchema = z
  .object({
    id: z.string().min(1),
    merchant_id: z.string().min(1),
    category_id: z.string().nullable(),
    name: z.string().min(1),
    brand: z.string().nullable(),
    category: z.string().nullable(),
    description: z.string().nullable(),
    images: z.unknown(),
    price: z.number().finite(),
    slug: z.string().nullable().optional(),
    status: z.string().nullable(),
    stock: z.number().nullable(),
    stock_quantity: z.number().nullable().optional(),
    manage_stock: z.boolean(),
    has_variants: z.boolean(),
    has_condition_offers: z.boolean(),
    available_conditions: z.array(z.unknown()).nullable().optional(),
    variant_model: z.string(),
    condition: z.string().nullable().optional(),
    product_key_specs: z.unknown().optional(),
  })
  .passthrough();

const variantRowSchema = z
  .object({
    id: z.string().min(1),
    product_id: z.string().min(1),
    attributes: z.record(z.string(), z.unknown()).nullable().optional(),
    price_override: z
      .union([z.number().finite(), z.string()])
      .nullable()
      .optional(),
    stock_quantity: z.number().finite().nullable().optional(),
    available_units: z.number().finite().nullable().optional(),
    effective_policy: z.string().nullable().optional(),
    condition: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    is_active: z.boolean().nullable().optional(),
    is_inventory_anchor: z.boolean().nullable().optional(),
    archived_at: z.string().nullable().optional(),
    deleted_at: z.string().nullable().optional(),
  })
  .passthrough();

function catalogMatchesPreference(specs: unknown, preference: string): boolean {
  const record = Array.isArray(specs) ? specs[0] : specs;
  if (!record || typeof record !== 'object' || !('recommended_for' in record))
    return false;
  const recommendations = record.recommended_for;
  if (!Array.isArray(recommendations)) return false;
  const matchers: Record<string, RegExp> = {
    gaming: /\bgaming\b/i,
    camera: /\b(?:camera|photograph\w*)\b/i,
    battery: /\bbattery\b/i,
  };
  const matcher = matchers[preference];
  return (
    !!matcher &&
    recommendations.some(
      (item) => typeof item === 'string' && matcher.test(item)
    )
  );
}

function catalogMatchesModel(
  query: string,
  name: string,
  brand: string | null
): boolean {
  const words = (value: string) =>
    normalizeAccessoryNouns(value)
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  const required = words(query);
  const actual = new Set(words(`${name} ${brand ?? ''}`));
  return required.length > 0 && required.every((word) => actual.has(word));
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
  const ranked = intent.query
    ? await searchStorefrontProducts({
        supabase,
        merchantId,
        query: intent.query,
        filters: { categoryId: intent.categoryId },
        limit: 50,
        includeDidYouMean: false,
      })
    : null;
  if (ranked && ranked.productIds.length === 0) return [];

  let query = supabase
    .from('products')
    .select(
      `${CHAT_PRODUCT_PROJECTION},merchant_id,category_id,product_key_specs(recommended_for)`
    )
    .eq('merchant_id', merchantId)
    .eq('status', 'active')
    .order('view_count', { ascending: false, nullsFirst: false });
  if (intent.categoryId) query = query.eq('category_id', intent.categoryId);
  if (ranked) query = query.in('id', ranked.productIds);
  const { data, error } = await query.limit(ranked ? 50 : 200);
  if (error) throw new Error('Catalog unavailable');
  const rankedIds = ranked ? new Set(ranked.productIds) : null;
  const rows = (data ?? [])
    .flatMap((row) => {
      const parsed = productRowSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    })
    .filter(
      (row) =>
        row.merchant_id === merchantId &&
        (!intent.categoryId || row.category_id === intent.categoryId) &&
        row.status === 'active' &&
        (!intent.phoneProtectiveAccessory ||
          catalogNamesPhoneAccessory(row.name)) &&
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
      const parsed = variantRowSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    });
  }
  const phoneProductIds = new Set(
    rows
      .filter((row) => intent.phoneCategoryIds?.includes(row.category_id ?? ''))
      .map((row) => row.id)
  );
  return selectFastCatalogProducts(products, variants, {
    ...intent,
    phoneProductIds,
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
