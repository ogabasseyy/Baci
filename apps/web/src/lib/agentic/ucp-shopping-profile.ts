import type { AgentCommerceManifest } from '@/lib/agentic/agent-commerce-manifest';
import {
  CHECKOUT_SESSION_CAPABILITIES,
  UCP_PROFILE_VERSION,
} from '@/lib/agentic/ucp-profile-constants';
import { UCP_SHOPPING_URLS } from '@/lib/agentic/ucp-shopping-capability-urls';

const UCP_CHECKOUT_CAPABILITY = 'dev.ucp.shopping.checkout';
const UCP_CART_CAPABILITY = 'dev.ucp.shopping.cart';
const UCP_CATALOG_SEARCH_CAPABILITY = 'dev.ucp.shopping.catalog.search';
const UCP_CATALOG_LOOKUP_CAPABILITY = 'dev.ucp.shopping.catalog.lookup';
const UCP_ORDER_CAPABILITY = 'dev.ucp.shopping.order';
const UCP_SHOPPING_SERVICE = 'dev.ucp.shopping';
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
          ...UCP_SHOPPING_URLS.catalogSearch,
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
          ...UCP_SHOPPING_URLS.catalogLookup,
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
          ...UCP_SHOPPING_URLS.cart,
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
        ...UCP_SHOPPING_URLS.service,
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
    ...UCP_SHOPPING_URLS.checkout,
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
    ...UCP_SHOPPING_URLS.order,
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
  schema: string;
  spec: string;
}) {
  return {
    version: UCP_PROFILE_VERSION,
    spec,
    schema,
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
