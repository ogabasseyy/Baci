import type { AgentCommerceManifest } from '@/lib/agentic/agent-commerce-manifest';
import {
  CHECKOUT_SESSION_CAPABILITIES,
  UCP_PROFILE_VERSION,
} from '@/lib/agentic/ucp-profile-constants';

const UCP_PROFILE_BASE_URL = `https://ucp.dev/${UCP_PROFILE_VERSION}`;
const UCP_SPEC_BASE_URL = `${UCP_PROFILE_BASE_URL}/specification`;
const UCP_SCHEMA_BASE_URL = `${UCP_PROFILE_BASE_URL}/schemas/shopping`;
const UCP_SHOPPING_REST_SCHEMA_URL = `${UCP_PROFILE_BASE_URL}/services/shopping/rest.openapi.json`;
const UCP_CHECKOUT_CAPABILITY = 'dev.ucp.shopping.checkout';
const UCP_CART_CAPABILITY = 'dev.ucp.shopping.cart';
const UCP_CATALOG_SEARCH_CAPABILITY = 'dev.ucp.shopping.catalog.search';
const UCP_CATALOG_LOOKUP_CAPABILITY = 'dev.ucp.shopping.catalog.lookup';
const UCP_ORDER_CAPABILITY = 'dev.ucp.shopping.order';
const UCP_SHOPPING_SERVICE = 'dev.ucp.shopping';
const UCP_SHOPPING_SPEC_URL = `${UCP_SPEC_BASE_URL}/overview`;
const UCP_CHECKOUT_SPEC_URL = `${UCP_SPEC_BASE_URL}/checkout`;
const UCP_CART_SPEC_URL = `${UCP_SPEC_BASE_URL}/cart`;
const UCP_CATALOG_SPEC_URL = `${UCP_SPEC_BASE_URL}/catalog`;
const UCP_ORDER_SPEC_URL = `${UCP_SPEC_BASE_URL}/order`;
const UCP_CHECKOUT_SCHEMA_URL = `${UCP_SCHEMA_BASE_URL}/checkout.json`;
const UCP_ORDER_SCHEMA_URL = `${UCP_SCHEMA_BASE_URL}/order.json`;
type OperationMap = Record<string, string>;

export function buildUcpCapabilities({
  agenticApiBaseUrl,
  agentCommerceManifestUrl,
  manifest,
}: {
  agenticApiBaseUrl: string;
  agentCommerceManifestUrl: string;
  manifest: AgentCommerceManifest;
}) {
  const capabilities: Record<string, unknown[]> = {};

  if (manifest.capabilities.includes('catalog.read')) {
    capabilities['com.usebaci.catalog.read'] = [
      {
        version: manifest.schema_version,
        spec: agentCommerceManifestUrl,
        config: {
          feed: manifest.links.product_feed,
          product_api: manifest.links.product_api,
        },
      },
    ];
  }

  addCapability(capabilities, UCP_CATALOG_SEARCH_CAPABILITY, () =>
    hasNativeCatalogCapability(manifest)
      ? buildRestCapability({
          agenticApiBaseUrl,
          manifest,
          operations: {
            search_catalog: buildUcpOperationUrl(
              agenticApiBaseUrl,
              'catalog/search'
            ),
          },
          spec: UCP_CATALOG_SPEC_URL,
        })
      : null
  );
  addCapability(capabilities, UCP_CATALOG_LOOKUP_CAPABILITY, () =>
    hasNativeCatalogCapability(manifest)
      ? buildRestCapability({
          agenticApiBaseUrl,
          manifest,
          operations: {
            get_product: buildUcpOperationUrl(
              agenticApiBaseUrl,
              'catalog/product'
            ),
            lookup_catalog: buildUcpOperationUrl(
              agenticApiBaseUrl,
              'catalog/lookup'
            ),
          },
          spec: UCP_CATALOG_SPEC_URL,
        })
      : null
  );
  addCapability(capabilities, UCP_CART_CAPABILITY, () =>
    hasCartCapability(manifest)
      ? buildRestCapability({
          agenticApiBaseUrl,
          manifest,
          operations: {
            cancel_cart: buildUcpOperationUrl(
              agenticApiBaseUrl,
              'carts/{id}/cancel'
            ),
            convert_cart_to_checkout: buildUcpOperationUrl(
              agenticApiBaseUrl,
              'carts/{id}/checkout'
            ),
            create_cart: buildUcpOperationUrl(agenticApiBaseUrl, 'carts'),
            get_cart: buildUcpOperationUrl(agenticApiBaseUrl, 'carts/{id}'),
            update_cart: buildUcpOperationUrl(agenticApiBaseUrl, 'carts/{id}'),
          },
          spec: UCP_CART_SPEC_URL,
        })
      : null
  );
  addCapability(capabilities, UCP_CHECKOUT_CAPABILITY, () =>
    buildUcpCheckoutCapability({ agenticApiBaseUrl, manifest })
  );
  addCapability(capabilities, UCP_ORDER_CAPABILITY, () =>
    buildUcpOrderCapability({ agenticApiBaseUrl, manifest })
  );

  return capabilities;
}

export function buildUcpServices({
  agenticApiBaseUrl,
  manifest,
}: {
  agenticApiBaseUrl: string;
  manifest: AgentCommerceManifest;
}) {
  const hasShoppingCapability =
    hasNativeCatalogCapability(manifest) ||
    hasCartCapability(manifest) ||
    (hasCheckoutCapabilities(manifest) && hasCheckoutLinks(manifest)) ||
    hasOrderCapability(manifest);

  if (!hasShoppingCapability) {
    return {};
  }

  return {
    [UCP_SHOPPING_SERVICE]: [
      {
        endpoint: agenticApiBaseUrl,
        schema: UCP_SHOPPING_REST_SCHEMA_URL,
        spec: UCP_SHOPPING_SPEC_URL,
        transport: 'rest',
        version: UCP_PROFILE_VERSION,
      },
    ],
  };
}

function addCapability(
  capabilities: Record<string, unknown[]>,
  key: string,
  build: () => unknown | null
) {
  const capability = build();
  if (capability) {
    capabilities[key] = [capability];
  }
}

function buildUcpCheckoutCapability({
  agenticApiBaseUrl,
  manifest,
}: {
  agenticApiBaseUrl: string;
  manifest: AgentCommerceManifest;
}) {
  if (!hasCheckoutCapabilities(manifest) || !hasCheckoutLinks(manifest)) {
    return null;
  }

  return buildRestCapability({
    agenticApiBaseUrl,
    manifest,
    operations: {
      cancel_checkout: toUcpOperationUrlTemplate(
        manifest.links.checkout_session_cancel ?? ''
      ),
      complete_checkout: toUcpOperationUrlTemplate(
        manifest.links.checkout_session_complete ?? ''
      ),
      create_checkout: toUcpOperationUrlTemplate(
        manifest.links.checkout_sessions ?? ''
      ),
      get_checkout: toUcpOperationUrlTemplate(
        manifest.links.checkout_session ?? ''
      ),
      update_checkout: toUcpOperationUrlTemplate(
        manifest.links.checkout_session ?? ''
      ),
    },
    schema: UCP_CHECKOUT_SCHEMA_URL,
    spec: UCP_CHECKOUT_SPEC_URL,
  });
}

function buildUcpOrderCapability({
  agenticApiBaseUrl,
  manifest,
}: {
  agenticApiBaseUrl: string;
  manifest: AgentCommerceManifest;
}) {
  if (!hasOrderCapability(manifest)) {
    return null;
  }

  return buildRestCapability({
    agenticApiBaseUrl,
    manifest,
    operations: {
      get_order: toUcpOperationUrlTemplate(manifest.links.order ?? ''),
    },
    schema: UCP_ORDER_SCHEMA_URL,
    spec: UCP_ORDER_SPEC_URL,
  });
}

function buildRestCapability({
  agenticApiBaseUrl,
  manifest,
  operations,
  schema,
  spec,
}: {
  agenticApiBaseUrl: string;
  manifest: AgentCommerceManifest;
  operations: OperationMap;
  schema?: string;
  spec: string;
}) {
  return {
    version: UCP_PROFILE_VERSION,
    spec,
    ...(schema ? { schema } : {}),
    config: {
      auth: buildUcpAuthConfig(manifest),
      rest: {
        endpoint: agenticApiBaseUrl,
        operations,
      },
    },
  };
}

function hasPresentString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasCheckoutLinks(manifest: AgentCommerceManifest): boolean {
  return [
    manifest.links.checkout_sessions,
    manifest.links.checkout_session,
    manifest.links.checkout_session_complete,
    manifest.links.checkout_session_cancel,
  ].every(hasPresentString);
}

function hasCheckoutCapabilities(manifest: AgentCommerceManifest): boolean {
  return CHECKOUT_SESSION_CAPABILITIES.every((capability) =>
    manifest.capabilities.includes(capability)
  );
}

function hasCartCapability(manifest: AgentCommerceManifest): boolean {
  // Signed cart transfers are available independently of native checkout.
  // This does not advertise payment or order operations.
  return manifest.auth !== null;
}

function hasNativeCatalogCapability(manifest: AgentCommerceManifest): boolean {
  return (
    manifest.auth !== null && manifest.capabilities.includes('catalog.read')
  );
}

function hasOrderCapability(manifest: AgentCommerceManifest): boolean {
  return (
    manifest.capabilities.includes('order.read') &&
    hasPresentString(manifest.links.order)
  );
}

function toUcpOperationUrlTemplate(url: string): string {
  return url
    .replace(/checkout_sessions/g, 'checkout-sessions')
    .replace(/\{session_id\}/g, '{id}')
    .replace(/\{order_id\}/g, '{id}');
}

function buildUcpOperationUrl(agenticApiBaseUrl: string, path: string): string {
  return `${agenticApiBaseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function buildUcpAuthConfig(manifest: AgentCommerceManifest) {
  return manifest.auth
    ? {
        supported_api_versions: manifest.auth.supported_api_versions,
        type: manifest.auth.type,
      }
    : null;
}
