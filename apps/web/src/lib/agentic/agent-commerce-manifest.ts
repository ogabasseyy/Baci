import type { AgenticPaymentMethod } from '@/config/agentic-payment-methods';
import { STOREFRONT_AGENT_ROUTES } from '@/config/storefront-agent-routes';
import { STOREFRONT_FEED_ROUTES } from '@/config/storefront-feed-routes';
import { decideAgenticPaymentMethods } from '@/lib/agentic/decide-agentic-payment-methods';
import {
  getConfiguredAgenticMerchantSlug,
  isAgenticCheckoutRuntimeConfigured,
} from '@/lib/agentic/merchant-context';
import { SUPPORTED_AGENTIC_API_VERSIONS } from '@/lib/agentic/request-integrity';
import type { CachedMerchant } from '@/lib/cached-data';
import {
  type AgentPolicyUrls,
  buildAgentPolicyUrls,
} from '@/lib/storefront-agent-urls';

export const AGENT_COMMERCE_SCHEMA_VERSION = '2026-04-30';

const AGENT_COMMERCE_CHECKOUT_CAPABILITIES = [
  'checkout.session.create',
  'checkout.session.read',
  'checkout.session.update',
  'checkout.session.complete',
  'checkout.session.cancel',
] as const;
const AGENT_COMMERCE_ORDER_READ_CAPABILITY = 'order.read';
const AGENTIC_REQUIRED_HEADERS = [
  'api-version',
  'authorization',
  'request-id',
  'signature',
  'timestamp',
] as const;
const AGENTIC_MUTATION_REQUIRED_HEADERS = [
  ...AGENTIC_REQUIRED_HEADERS,
  'idempotency-key',
] as const;
const AGENTIC_OPTIONAL_IDENTITY_HEADERS = ['agent-id'] as const;

type MerchantPaymentConfig = Pick<
  CachedMerchant,
  | 'business_name'
  | 'feature_settings'
  | 'paystack_subaccount_code'
  | 'paystack_subaccount_configured'
  | 'slug'
>;

type AgentCommerceCheckoutLinks = {
  checkout_session: string;
  checkout_session_cancel: string;
  checkout_session_complete: string;
  checkout_sessions: string;
  order: string;
};

type AgentCommerceLinks = AgentPolicyUrls &
  Partial<AgentCommerceCheckoutLinks> & {
    agent_native_commerce: string;
    feeds: {
      agent_products: string;
      agent_repairs: string;
      facebook_catalog_xml: string;
      facebook_repairs_xml: string;
      google_merchant_xml: string;
    };
    llms: string;
    llms_full: string;
    product_api: string;
    product_feed: string;
    trust: string;
  };

export type AgentCommerceManifest = {
  auth: ReturnType<typeof buildAgenticCheckoutAuth> | null;
  capabilities: string[];
  links: AgentCommerceLinks;
  payment_methods: AgenticPaymentMethod[];
  platform: 'baci';
  schema_version: typeof AGENT_COMMERCE_SCHEMA_VERSION;
  store: {
    canonical_origin: string;
    name: string;
    slug: string;
  };
};

export function buildUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl).toString();
}

/**
 * buildTemplateUrl preserves placeholders like {session_id}; buildUrl uses URL
 * for concrete paths where braces should not be string-concatenated.
 */
export function buildTemplateUrl(baseUrl: string, path: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBaseUrl}${normalizedPath}`;
}

export function buildAgentCommerceManifest(
  merchant: MerchantPaymentConfig,
  baseUrl: string
): AgentCommerceManifest {
  const paymentMethods = decideAgenticPaymentMethods(merchant)
    .filter((decision) => decision.ready)
    .map((decision) => decision.method);
  const signedAgentReadsEnabled =
    isAgenticCheckoutRuntimeConfigured() &&
    merchant.slug === getConfiguredAgenticMerchantSlug();
  const checkoutEnabled =
    signedAgentReadsEnabled &&
    merchant.feature_settings?.agentic_checkout_enabled !== false &&
    paymentMethods.length > 0;
  const checkoutLinks = checkoutEnabled ? buildCheckoutLinks(baseUrl) : {};
  const orderLinks = signedAgentReadsEnabled ? buildOrderLinks(baseUrl) : {};

  return {
    schema_version: AGENT_COMMERCE_SCHEMA_VERSION,
    platform: 'baci',
    store: {
      slug: merchant.slug,
      name: merchant.business_name,
      canonical_origin: baseUrl,
    },
    capabilities: [
      'catalog.read',
      ...(signedAgentReadsEnabled
        ? [AGENT_COMMERCE_ORDER_READ_CAPABILITY]
        : []),
      ...(checkoutEnabled ? [...AGENT_COMMERCE_CHECKOUT_CAPABILITIES] : []),
    ],
    payment_methods: checkoutEnabled ? paymentMethods : [],
    auth: signedAgentReadsEnabled ? buildAgenticCheckoutAuth() : null,
    links: {
      agent_native_commerce: buildUrl(
        baseUrl,
        STOREFRONT_AGENT_ROUTES.agentNativeCommerce
      ),
      llms: buildUrl(baseUrl, '/llms.txt'),
      llms_full: buildUrl(baseUrl, '/llms-full.txt'),
      trust: buildUrl(baseUrl, STOREFRONT_AGENT_ROUTES.trust),
      product_feed: buildUrl(baseUrl, STOREFRONT_FEED_ROUTES.openaiProductFeed),
      feeds: {
        agent_products: buildUrl(baseUrl, STOREFRONT_FEED_ROUTES.agentProducts),
        agent_repairs: buildUrl(baseUrl, STOREFRONT_FEED_ROUTES.agentRepairs),
        facebook_catalog_xml: buildUrl(
          baseUrl,
          STOREFRONT_FEED_ROUTES.facebookCatalogXml
        ),
        facebook_repairs_xml: buildUrl(
          baseUrl,
          STOREFRONT_FEED_ROUTES.facebookRepairsXml
        ),
        google_merchant_xml: buildUrl(
          baseUrl,
          STOREFRONT_FEED_ROUTES.googleMerchantXml
        ),
      },
      product_api: buildUrl(
        baseUrl,
        `/api/storefront/${encodeURIComponent(merchant.slug)}/products`
      ),
      ...orderLinks,
      ...checkoutLinks,
      ...buildAgentPolicyUrls(baseUrl),
    },
  };
}

function buildAgenticCheckoutAuth() {
  return {
    type: 'bearer_hmac',
    bearer: {
      header: 'Authorization',
      scheme: 'Bearer',
    },
    request_signing: {
      algorithm: 'hmac-sha256',
      required_headers: [...AGENTIC_REQUIRED_HEADERS],
      mutation_required_headers: [...AGENTIC_MUTATION_REQUIRED_HEADERS],
      optional_identity_headers: [...AGENTIC_OPTIONAL_IDENTITY_HEADERS],
      signed_payload:
        'json(api_version, body, idempotency_key, method, pathname, request_id, timestamp, optional agent_id)',
    },
    supported_api_versions: [...SUPPORTED_AGENTIC_API_VERSIONS] as string[],
  };
}

function buildCheckoutLinks(baseUrl: string) {
  const agenticApiBase = STOREFRONT_AGENT_ROUTES.agenticApiBase;

  return {
    checkout_sessions: buildUrl(baseUrl, `${agenticApiBase}/checkout_sessions`),
    checkout_session: buildTemplateUrl(
      baseUrl,
      `${agenticApiBase}/checkout_sessions/{session_id}`
    ),
    checkout_session_complete: buildTemplateUrl(
      baseUrl,
      `${agenticApiBase}/checkout_sessions/{session_id}/complete`
    ),
    checkout_session_cancel: buildTemplateUrl(
      baseUrl,
      `${agenticApiBase}/checkout_sessions/{session_id}/cancel`
    ),
  };
}

function buildOrderLinks(baseUrl: string) {
  return {
    order: buildTemplateUrl(
      baseUrl,
      `${STOREFRONT_AGENT_ROUTES.agenticApiBase}/orders/{order_id}`
    ),
  };
}
