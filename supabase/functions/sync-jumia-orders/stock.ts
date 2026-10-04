import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { MarketplaceIntegration, ProductMapping } from './types.ts';

export interface JumiaStockConfig {
  apiBase: string;
}

type ShopsResponse = {
  shops?: Array<{
    id?: unknown;
    businessClients?: Array<{ status?: unknown }>;
  }>;
};

/**
 * Counts the shop's active business clients via the provider. Returns null
 * when the shop cannot be verified (network failure, unexpected payload,
 * unknown shop) so callers fail closed.
 */
async function loadActiveBusinessClientCount(args: {
  apiBase: string;
  shopId: string;
  accessToken: string;
  refreshToken: () => Promise<string>;
}): Promise<number | null> {
  const fetchShops = (token: string) =>
    fetch(`${args.apiBase}/shops`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
  let response = await fetchShops(args.accessToken);
  if (response.status === 401) {
    response = await fetchShops(await args.refreshToken());
  }
  if (!response.ok) return null;
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }
  const shops = Array.isArray(payload)
    ? payload
    : (payload as ShopsResponse)?.shops;
  if (!Array.isArray(shops)) return null;
  const shop = (
    shops as Array<{ id?: unknown; businessClients?: unknown }>
  ).find(
    (candidate) =>
      typeof candidate === 'object' &&
      candidate !== null &&
      candidate.id === args.shopId
  );
  const businessClients = shop?.businessClients as
    | Array<{ status?: unknown }>
    | undefined;
  if (!Array.isArray(businessClients)) return null;
  return businessClients.filter(
    (businessClient) =>
      typeof businessClient?.status === 'string' &&
      businessClient.status.toLowerCase() === 'active'
  ).length;
}

function resolveEffectiveStock(product: {
  stock: unknown;
  stock_quantity: unknown;
}): number {
  const toNonNeg = (value: unknown): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(0, Math.trunc(value));
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const numberValue = Number(value);
      return Number.isFinite(numberValue)
        ? Math.max(0, Math.trunc(numberValue))
        : 0;
    }
    return 0;
  };

  const stockQuantity = toNonNeg(product.stock_quantity);
  const legacyStock = toNonNeg(product.stock);
  if (product.stock_quantity == null) return legacyStock;
  if (stockQuantity === 0 && legacyStock > 0) return legacyStock;
  return stockQuantity;
}

export async function syncJumiaStockForIntegration(args: {
  supabase: SupabaseClient;
  integration: MarketplaceIntegration;
  accessToken: string;
  config: JumiaStockConfig;
  refreshToken: () => Promise<string>;
}): Promise<{ updated: number; skipped: number }> {
  const { supabase, integration, accessToken, config, refreshToken } = args;
  const { data: mappings, error: mappingsError } = await supabase
    .from('jumia_product_mappings')
    .select(
      'id, product_id, variant_id, jumia_seller_sku, jumia_product_id, baci_stock_at_last_sync'
    )
    .eq('merchant_id', integration.merchant_id)
    .eq('jumia_shop_id', integration.shop_id)
    .eq('sync_status', 'synced')
    .eq('marketplace_key', integration.marketplace_key?.trim() || 'oauth');

  if (mappingsError || !mappings || mappings.length === 0) {
    return { updated: 0, skipped: 0 };
  }

  const pushReady: ProductMapping[] = [];
  let skipped = 0;
  for (const mapping of mappings) {
    const sellerSku = mapping.jumia_seller_sku;
    const productId = mapping.jumia_product_id;
    if (!sellerSku?.trim() || !productId?.trim()) {
      skipped++;
      continue;
    }
    pushReady.push({
      ...(mapping as ProductMapping),
      jumia_seller_sku: sellerSku,
      jumia_product_id: productId,
    });
  }
  if (pushReady.length === 0) return { updated: 0, skipped };

  // The stock-feed contract has no business-client selector. One OAuth
  // shop can expose several active business clients under a single
  // marketplace_key='oauth' integration, so an unscoped feed could apply
  // inventory outside the intended marketplace. Fail closed: skip shops
  // that are ambiguous or cannot be verified.
  const activeMarketplaces = await loadActiveBusinessClientCount({
    apiBase: config.apiBase,
    shopId: integration.shop_id,
    accessToken,
    refreshToken,
  });
  if (activeMarketplaces !== 1) {
    console.error(
      `[Jumia Sync] Stock: skipping shop ${integration.shop_id} with ${activeMarketplaces ?? 'unverifiable'} active marketplace(s)`
    );
    return { updated: 0, skipped };
  }

  const variantIds = pushReady.flatMap((mapping) =>
    mapping.variant_id ? [mapping.variant_id] : []
  );
  const productOnlyIds = pushReady
    .filter((mapping) => !mapping.variant_id)
    .map((mapping) => mapping.product_id);

  const variantStockMap = new Map<string, number>();
  if (variantIds.length > 0) {
    const { data: variants, error: variantsError } = await supabase
      .from('product_variants')
      .select('id, stock_quantity')
      .in('id', variantIds);
    if (variantsError) {
      console.error(
        `[Jumia Sync] Stock: failed to fetch variant stock for merchant ${integration.merchant_id}:`,
        variantsError.message
      );
    }
    for (const variant of variants || []) {
      variantStockMap.set(
        variant.id,
        Math.max(0, Math.trunc(Number(variant.stock_quantity) || 0))
      );
    }
  }

  const productStockMap = new Map<string, number>();
  if (productOnlyIds.length > 0) {
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, stock, stock_quantity')
      .in('id', productOnlyIds);
    if (productsError) {
      console.error(
        `[Jumia Sync] Stock: failed to fetch product stock for merchant ${integration.merchant_id}:`,
        productsError.message
      );
    }
    for (const product of products || []) {
      productStockMap.set(product.id, resolveEffectiveStock(product));
    }
  }

  const stockUpdates: Array<{
    mappingId: string;
    sellerSku: string;
    id: string;
    stock: number;
  }> = [];
  for (const mapping of pushReady) {
    const stock = mapping.variant_id
      ? variantStockMap.get(mapping.variant_id)
      : productStockMap.get(mapping.product_id);
    if (stock === undefined) {
      skipped++;
      continue;
    }
    if (stock === mapping.baci_stock_at_last_sync) continue;
    stockUpdates.push({
      mappingId: mapping.id,
      sellerSku: mapping.jumia_seller_sku,
      id: mapping.jumia_product_id,
      stock,
    });
  }
  if (stockUpdates.length === 0) return { updated: 0, skipped };

  const stockPayload = {
    products: stockUpdates.map(({ sellerSku, id, stock }) => ({
      sellerSku,
      id,
      stock,
    })),
  };
  let currentToken = accessToken;
  let response = await fetch(`${config.apiBase}/feeds/products/stock`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${currentToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(stockPayload),
  });

  if (response.status === 401) {
    currentToken = await refreshToken();
    response = await fetch(`${config.apiBase}/feeds/products/stock`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${currentToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(stockPayload),
    });
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '<unreadable body>');
    throw new Error(`Jumia stock feed error: ${response.status} - ${body}`);
  }

  const feedData = await response.json();
  const feedId = feedData.feedId || null;
  const now = new Date().toISOString();
  const updateResults = await Promise.all(
    stockUpdates.map(async (update) => {
      const { error } = await supabase
        .from('jumia_product_mappings')
        .update({
          baci_stock_at_last_sync: update.stock,
          last_stock_synced_at: now,
          ...(feedId ? { last_feed_id: feedId } : {}),
        })
        .eq('id', update.mappingId);
      return { mappingId: update.mappingId, error };
    })
  );

  const trackingFailures = updateResults.filter(
    (result) => result.error !== null
  );
  if (trackingFailures.length > 0) {
    console.error(
      `[Jumia Sync] Stock: ${trackingFailures.length} mapping update(s) failed for merchant ${integration.merchant_id}:`,
      trackingFailures.map((failure) => failure.mappingId)
    );
  }
  return { updated: stockUpdates.length, skipped };
}
