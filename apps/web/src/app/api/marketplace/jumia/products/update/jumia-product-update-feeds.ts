import type { JumiaClient } from '@/lib/jumia/client';
import { updatePrice, updateStatus } from '@/lib/jumia/feeds';
import type { IntegrationScopedMapping } from '@/lib/jumia/product-mapping-scope';
import { logger } from '@/lib/logger';
import { getJumiaOAuthScopeError } from './verify-jumia-update-oauth-scope';

interface SalePriceResult {
  value: number;
  startAt: string | null;
  endAt: string | null;
}

export function resolveSalePrice(
  overrides: {
    jumia_sale_price?: number | null;
    jumia_sale_start?: string | null;
    jumia_sale_end?: string | null;
  },
  mapping: {
    jumia_sale_price: number | null;
    jumia_sale_start: string | null;
    jumia_sale_end: string | null;
  }
): SalePriceResult | undefined {
  if (
    Object.hasOwn(overrides, 'jumia_sale_price') &&
    overrides.jumia_sale_price != null
  ) {
    return {
      value: overrides.jumia_sale_price,
      startAt: Object.hasOwn(overrides, 'jumia_sale_start')
        ? (overrides.jumia_sale_start ?? null)
        : (mapping.jumia_sale_start ?? null),
      endAt: Object.hasOwn(overrides, 'jumia_sale_end')
        ? (overrides.jumia_sale_end ?? null)
        : (mapping.jumia_sale_end ?? null),
    };
  }

  if (
    Object.hasOwn(overrides, 'jumia_sale_price') &&
    overrides.jumia_sale_price == null
  ) {
    return undefined;
  }

  if (
    (Object.hasOwn(overrides, 'jumia_sale_start') ||
      Object.hasOwn(overrides, 'jumia_sale_end')) &&
    mapping.jumia_sale_price != null
  ) {
    return {
      value: mapping.jumia_sale_price,
      startAt: Object.hasOwn(overrides, 'jumia_sale_start')
        ? (overrides.jumia_sale_start ?? null)
        : (mapping.jumia_sale_start ?? null),
      endAt: Object.hasOwn(overrides, 'jumia_sale_end')
        ? (overrides.jumia_sale_end ?? null)
        : (mapping.jumia_sale_end ?? null),
    };
  }

  return undefined;
}

export function getJumiaProductUpdateReadinessErrors(
  mappings: Array<{ jumia_product_id: string | null }>,
  includesStatus: boolean,
  includesPrice: boolean
): string[] {
  const readyCount = mappings.filter(
    (mapping) => mapping.jumia_product_id
  ).length;
  const hasPendingMappings = mappings.some(
    (mapping) => !mapping.jumia_product_id
  );
  if (readyCount > 0 && !hasPendingMappings) return [];

  const suffix =
    readyCount > 0
      ? 'skipped: one or more product variants have not been assigned a Jumia product ID yet (feed may still be processing)'
      : 'skipped: product has not been assigned a Jumia product ID yet (feed may still be processing)';
  return [
    ...(includesStatus ? [`Status update ${suffix}`] : []),
    ...(includesPrice ? [`Price update ${suffix}`] : []),
  ];
}

export function getJumiaProductUpdateReadiness(
  mappings: Array<{ jumia_product_id: string | null }>,
  includesStatus: boolean,
  includesPrice: boolean
): { errors: string[] } | null {
  const errors = getJumiaProductUpdateReadinessErrors(
    mappings,
    includesStatus,
    includesPrice
  );
  return errors.length > 0 ? { errors } : null;
}

export function hasJumiaPriceOverrides(
  overrides: Record<string, unknown>
): boolean {
  return [
    'jumia_price',
    'jumia_sale_price',
    'jumia_sale_start',
    'jumia_sale_end',
    'jumia_prices',
  ].some((key) => Object.hasOwn(overrides, key));
}

export function getJumiaPriceOverrideError(
  mappings: Array<{ jumia_sku: string; jumia_price: number | null }>,
  overrides: { jumia_price?: number; jumia_prices?: Record<string, number> }
): string | null {
  if (overrides.jumia_prices) {
    const knownSkus = new Set(mappings.map((mapping) => mapping.jumia_sku));
    const unknownSku = Object.keys(overrides.jumia_prices).find(
      (sku) => !knownSkus.has(sku)
    );
    if (unknownSku) {
      return `No Jumia mapping exists for SKU ${unknownSku}`;
    }
  }
  return null;
}

function getBusinessClientCode(
  client: Pick<JumiaClient, 'marketplaceKey'>
): string | undefined {
  const key = client.marketplaceKey.trim();
  return key && key !== 'default' && key !== 'oauth' ? key : undefined;
}

function getBusinessClientPricePayload(
  client: Pick<JumiaClient, 'marketplaceKey'>,
  price: {
    value: number;
    currency: string;
    salePrice?: SalePriceResult;
  }
): {
  businessClients?: Array<{
    businessClientCode: string;
    price: {
      value: number;
      currency: string;
      salePrice?: SalePriceResult;
    };
  }>;
} {
  const businessClientCode = getBusinessClientCode(client);
  return businessClientCode
    ? { businessClients: [{ businessClientCode, price }] }
    : {};
}

function getBusinessClientStatusPayload(
  client: Pick<JumiaClient, 'marketplaceKey'>,
  status: 'active' | 'inactive' | 'deleted'
): {
  businessClients?: Array<{
    businessClientCode: string;
    status: 'active' | 'inactive' | 'deleted';
  }>;
} {
  const businessClientCode = getBusinessClientCode(client);
  return businessClientCode
    ? { businessClients: [{ businessClientCode, status }] }
    : {};
}

export async function pushStatusUpdates(
  client: JumiaClient,
  mappings: IntegrationScopedMapping[],
  isActive: boolean,
  feedIds: string[],
  feedErrors: string[]
): Promise<void> {
  const readyMappings = mappings.filter((mapping) => mapping.jumia_product_id);
  if (readyMappings.length !== mappings.length) {
    feedErrors.push(
      readyMappings.length > 0
        ? 'Status update skipped: one or more product variants have not been assigned a Jumia product ID yet (feed may still be processing)'
        : 'Status update skipped: product has not been assigned a Jumia product ID yet (feed may still be processing)'
    );
    return;
  }

  const scopeError = await getJumiaOAuthScopeError(client, 'Status');
  if (scopeError) {
    feedErrors.push(scopeError);
    return;
  }

  try {
    const statusFeedId = await updateStatus(
      client,
      readyMappings.map((mapping) => ({
        id: mapping.jumia_product_id as string,
        sellerSku: mapping.jumia_sku,
        status: isActive ? 'active' : 'inactive',
        ...getBusinessClientStatusPayload(
          client,
          isActive ? 'active' : 'inactive'
        ),
      }))
    );
    feedIds.push(statusFeedId);
  } catch (err) {
    logger.error({ message: 'Jumia status feed failed', error: err });
    feedErrors.push(
      `Status update failed: ${err instanceof Error ? err.message : 'Unknown error'}`
    );
  }
}

export async function pushPriceUpdates(
  client: JumiaClient,
  mappings: IntegrationScopedMapping[],
  overrides: {
    jumia_price?: number;
    jumia_sale_price?: number | null;
    jumia_sale_start?: string | null;
    jumia_sale_end?: string | null;
    jumia_prices?: Record<string, number>;
  },
  currency: string,
  feedIds: string[],
  feedErrors: string[]
): Promise<void> {
  const readyMappings = mappings.filter((mapping) => mapping.jumia_product_id);
  if (readyMappings.length !== mappings.length) {
    feedErrors.push(
      readyMappings.length > 0
        ? 'Price update skipped: one or more product variants have not been assigned a Jumia product ID yet (feed may still be processing)'
        : 'Price update skipped: product has not been assigned a Jumia product ID yet (feed may still be processing)'
    );
    return;
  }

  const scopeError = await getJumiaOAuthScopeError(client, 'Price');
  if (scopeError) {
    feedErrors.push(scopeError);
    return;
  }

  const priceItems = readyMappings.flatMap((mapping) => {
    const resolvedPrice = Object.hasOwn(overrides, 'jumia_prices')
      ? (overrides.jumia_prices?.[mapping.jumia_sku] ?? mapping.jumia_price)
      : Object.hasOwn(overrides, 'jumia_price')
        ? overrides.jumia_price
        : mapping.jumia_price;
    if (resolvedPrice == null) {
      feedErrors.push(
        `Price update skipped for ${mapping.jumia_sku}: no price available (override or existing)`
      );
      return [];
    }

    return [
      {
        id: mapping.jumia_product_id as string,
        sellerSku: mapping.jumia_sku,
        price: {
          value: resolvedPrice,
          currency,
          salePrice: resolveSalePrice(overrides, mapping),
        },
        ...getBusinessClientPricePayload(client, {
          value: resolvedPrice,
          currency,
          salePrice: resolveSalePrice(overrides, mapping),
        }),
      },
    ];
  });

  if (priceItems.length === 0) {
    return;
  }

  try {
    const priceFeedId = await updatePrice(client, priceItems);
    feedIds.push(priceFeedId);
  } catch (err) {
    logger.error({ message: 'Jumia price feed failed', error: err });
    feedErrors.push(
      `Price update failed: ${err instanceof Error ? err.message : 'Unknown error'}`
    );
  }
}
