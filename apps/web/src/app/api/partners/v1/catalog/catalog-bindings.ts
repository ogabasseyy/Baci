import { logger } from '@/lib/logger';
import { crossRemListingBindingsSchema } from '@/schemas/crossrem-listing-binding';
import ogabasseyBindings from './ogabassey-listing-bindings.json';

const parsedBindings =
  crossRemListingBindingsSchema.safeParse(ogabasseyBindings);
if (!parsedBindings.success) {
  const { issues } = parsedBindings.error;
  logger.warn({
    message: 'CrossRem catalog bindings failed validation',
    issueCount: issues.length,
    issues: issues.slice(0, 5).map(({ code, path }) => ({
      code,
      path: path.join('.'),
    })),
  });
}

// The versioned baseline preserves exact sellable identities. Keep retired IDs
// reserved by marking the old binding retired.
export const crossRemCatalogConfig = {
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  // Treat invalid data as unconfigured so the route can emit its 503 alert.
  bindings: parsedBindings.data ?? [],
} as const;

/** Ogabassey is the first configured merchant and CrossRem is its partner. */
export function getCrossRemConnections() {
  const connection = {
    id: 'crossrem-ogabassey',
    merchantId: crossRemCatalogConfig.merchantId,
  };

  return [
    {
      ...connection,
      token: process.env.CROSSREM_CATALOG_TOKEN,
      scopes: ['catalog:read'],
    },
    {
      ...connection,
      token: process.env.CROSSREM_QUOTE_TOKEN,
      scopes: ['quotes:write'],
    },
    {
      ...connection,
      token: process.env.CROSSREM_ORDER_TOKEN,
      scopes: ['orders:write', 'orders:read'],
    },
  ] as const;
}

export const crossRemDeliveryConfiguration = {
  carrier: 'GIGL',
  validityMs: 10 * 60 * 1000,
  get settlementBasis() {
    return process.env.CROSSREM_SETTLEMENT_BASIS === 'base_plus_delivery'
      ? 'base_plus_delivery'
      : null;
  },
} as const;
