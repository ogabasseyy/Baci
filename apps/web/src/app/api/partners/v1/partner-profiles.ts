import { crossRemCatalogConfig } from './catalog/catalog-bindings';
import { loadCrossRemCatalog } from './catalog/catalog-service';
import { getVersionedCrossRemCatalog } from './catalog/catalog-snapshot';
import type { PartnerProfile } from './partner-profile';

/** Profiles are provisioned by Baci with server-side credentials. */
export function getPartnerProfiles(): readonly PartnerProfile[] {
  return [
    {
      id: 'crossrem-ogabassey',
      merchantId: crossRemCatalogConfig.merchantId,
      credentials: [
        { token: process.env.CROSSREM_CATALOG_TOKEN, scopes: ['catalog:read'] },
        {
          token: process.env.CROSSREM_PARTNER_CATALOG_TOKEN,
          scopes: ['catalog:read'],
        },
        { token: process.env.CROSSREM_QUOTE_TOKEN, scopes: ['quotes:write'] },
        {
          token: process.env.CROSSREM_ORDER_TOKEN,
          scopes: ['orders:write', 'orders:read'],
        },
        {
          token: process.env.CROSSREM_VERIFIER_TOKEN,
          scopes: ['reconciliation:write'],
        },
      ],
      async loadCatalog() {
        const stockByListing = new Map<string, number>();
        const { listings } = await loadCrossRemCatalog(stockByListing);
        return { listings, stockByListing };
      },
      readCatalogSnapshot: getVersionedCrossRemCatalog,
      catalogFailure: {
        message: 'CrossRem catalog unavailable',
        event: 'crossrem_catalog_snapshot_unavailable',
      },
      delivery: {
        carrier: 'GIGL',
        validityMs: 10 * 60 * 1000,
        settlementBasis:
          process.env.CROSSREM_SETTLEMENT_BASIS === 'base_plus_delivery'
            ? 'base_plus_delivery'
            : null,
      },
    },
  ];
}
