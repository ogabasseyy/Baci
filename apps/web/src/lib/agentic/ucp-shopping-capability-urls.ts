import { UCP_PROFILE_VERSION } from '@/lib/agentic/ucp-profile-constants';

const PROFILE_BASE = `https://ucp.dev/${UCP_PROFILE_VERSION}`;
const SPEC_BASE = `${PROFILE_BASE}/specification`;
const SCHEMA_BASE = `${PROFILE_BASE}/schemas/shopping`;

/**
 * Spec and schema URLs for the UCP shopping declarations. Every capability
 * declaration needs `version`, `spec` and `schema`
 * (https://ucp.dev/2026-04-08/specification/overview/). The cart and catalog
 * values match the cart and catalog REST bindings and Google's published
 * profile example; catalog is two capabilities, search and lookup.
 */
export const UCP_SHOPPING_URLS = {
  cart: { schema: `${SCHEMA_BASE}/cart.json`, spec: `${SPEC_BASE}/cart` },
  catalogLookup: {
    schema: `${SCHEMA_BASE}/catalog_lookup.json`,
    spec: `${SPEC_BASE}/catalog/lookup`,
  },
  catalogSearch: {
    schema: `${SCHEMA_BASE}/catalog_search.json`,
    spec: `${SPEC_BASE}/catalog/search`,
  },
  checkout: {
    schema: `${SCHEMA_BASE}/checkout.json`,
    spec: `${SPEC_BASE}/checkout`,
  },
  order: { schema: `${SCHEMA_BASE}/order.json`, spec: `${SPEC_BASE}/order` },
  service: {
    schema: `${PROFILE_BASE}/services/shopping/rest.openapi.json`,
    spec: `${SPEC_BASE}/overview`,
  },
} as const;
