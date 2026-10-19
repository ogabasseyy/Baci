// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { AgentCommerceManifest } from '@/lib/agentic/agent-commerce-manifest';
import {
  buildUcpCapabilities,
  buildUcpServices,
} from '@/lib/agentic/ucp-shopping-profile';

const baseManifest: AgentCommerceManifest = {
  auth: null,
  capabilities: ['catalog.read'],
  links: {
    agent_native_commerce:
      'https://ogabassey.com/.well-known/agent-native-commerce',
    feeds: {
      agent_products: 'https://ogabassey.com/feeds/agent-products.jsonl',
      agent_repairs: 'https://ogabassey.com/feeds/agent-repairs.jsonl',
      facebook_catalog_xml: 'https://ogabassey.com/feeds/facebook.xml',
      facebook_repairs_xml: 'https://ogabassey.com/feeds/facebook-repairs.xml',
      google_merchant_xml: 'https://ogabassey.com/feeds/google-merchant.xml',
    },
    llms: 'https://ogabassey.com/llms.txt',
    llms_full: 'https://ogabassey.com/llms-full.txt',
    privacy_policy_url: 'https://ogabassey.com/privacy',
    product_api: 'https://ogabassey.com/api/storefront/ogabassey/products',
    product_feed: 'https://ogabassey.com/feeds/openai.jsonl',
    return_policy_url: 'https://ogabassey.com/returns',
    shipping_policy_url: 'https://ogabassey.com/shipping',
    terms_of_service_url: 'https://ogabassey.com/terms',
    trust: 'https://ogabassey.com/agent-trust.json',
  },
  payment_methods: [],
  platform: 'baci',
  schema_version: '2026-04-30',
  store: {
    canonical_origin: 'https://ogabassey.com',
    name: 'Ogabassey',
    slug: 'ogabassey',
  },
};

const checkoutAuth: NonNullable<AgentCommerceManifest['auth']> = {
  bearer: { header: 'Authorization', scheme: 'Bearer' },
  request_signing: {
    algorithm: 'hmac-sha256',
    mutation_required_headers: [
      'api-version',
      'authorization',
      'request-id',
      'signature',
      'timestamp',
      'idempotency-key',
    ],
    optional_identity_headers: ['agent-id'],
    required_headers: [
      'api-version',
      'authorization',
      'request-id',
      'signature',
      'timestamp',
    ],
    signed_payload: 'json(...)',
  },
  supported_api_versions: ['2026-04-30'],
  type: 'bearer_hmac',
};

function signedManifest(): AgentCommerceManifest {
  return {
    ...baseManifest,
    auth: checkoutAuth,
    capabilities: [
      'catalog.read',
      'checkout.session.create',
      'checkout.session.read',
      'checkout.session.update',
      'checkout.session.complete',
      'checkout.session.cancel',
      'order.read',
    ],
    links: {
      ...baseManifest.links,
      checkout_session:
        'https://ogabassey.com/api/agentic/checkout_sessions/{session_id}',
      checkout_session_cancel:
        'https://ogabassey.com/api/agentic/checkout_sessions/{session_id}/cancel',
      checkout_session_complete:
        'https://ogabassey.com/api/agentic/checkout_sessions/{session_id}/complete',
      checkout_sessions: 'https://ogabassey.com/api/agentic/checkout_sessions',
      order: 'https://ogabassey.com/api/agentic/orders/{order_id}',
    },
  };
}

describe('ucp shopping profile builders', () => {
  it('does not expose native UCP shopping routes without signed agent auth', () => {
    const capabilities = buildUcpCapabilities({
      agentCommerceManifestUrl: 'https://ogabassey.com/agent-commerce.json',
      agenticApiBaseUrl: 'https://ogabassey.com/api/agentic',
      manifest: baseManifest,
    });

    expect(
      buildUcpServices({ agenticApiBaseUrl: '', manifest: baseManifest })
    ).toEqual({});
    expect(capabilities).toHaveProperty('com.usebaci.catalog.read');
    expect(capabilities).not.toHaveProperty('dev.ucp.shopping.catalog.search');
  });

  it('advertises cart transfer independently of native checkout readiness', () => {
    const transferOnly: AgentCommerceManifest = {
      ...baseManifest,
      auth: checkoutAuth,
      capabilities: ['catalog.read'],
      links: { ...baseManifest.links },
    };
    const capabilities = buildUcpCapabilities({
      agentCommerceManifestUrl: 'https://ogabassey.com/agent-commerce.json',
      agenticApiBaseUrl: 'https://ogabassey.com/api/agentic',
      manifest: transferOnly,
    });
    expect(capabilities).toHaveProperty('dev.ucp.shopping.cart');
    expect(capabilities).not.toHaveProperty('dev.ucp.shopping.checkout');
  });

  it('builds cart and catalog operations without slash drift', () => {
    const capabilities = buildUcpCapabilities({
      agentCommerceManifestUrl: 'https://ogabassey.com/agent-commerce.json',
      agenticApiBaseUrl: 'https://ogabassey.com/api/agentic/',
      manifest: signedManifest(),
    });
    const cart = capabilities['dev.ucp.shopping.cart']?.[0] as {
      config: { rest: { operations: Record<string, string> } };
    };
    const search = capabilities['dev.ucp.shopping.catalog.search']?.[0] as {
      config: { rest: { operations: Record<string, string> } };
    };

    expect(cart.config.rest.operations.create_cart).toBe(
      'https://ogabassey.com/api/agentic/carts'
    );
    expect(search.config.rest.operations.search_catalog).toBe(
      'https://ogabassey.com/api/agentic/catalog/search'
    );
  });
});
