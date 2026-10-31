// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { AgentCommerceManifest } from '@/lib/agentic/agent-commerce-manifest';
import { buildUcpDiscoveryProfile } from '@/lib/agentic/ucp-discovery-profile';

const checkoutAuth: NonNullable<AgentCommerceManifest['auth']> = {
  bearer: {
    header: 'Authorization',
    scheme: 'Bearer',
  },
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
    required_headers: [
      'api-version',
      'authorization',
      'request-id',
      'signature',
      'timestamp',
    ],
    optional_identity_headers: ['agent-id'],
    signed_payload:
      'json(api_version, body, idempotency_key, method, pathname, request_id, timestamp, optional agent_id)',
  },
  supported_api_versions: ['2026-04-30', '2026-04-01'],
  type: 'bearer_hmac',
};

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

function buildSignedCheckoutManifest(): AgentCommerceManifest {
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
      'cart.transfer',
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
    payment_methods: ['paystack_bank_transfer'],
  };
}

describe('buildUcpDiscoveryProfile', () => {
  it('keeps catalog discovery without advertising native UCP services', () => {
    const profile = buildUcpDiscoveryProfile(baseManifest);

    expect(profile.ucp.version).toBe('2026-04-08');
    expect(profile.ucp.services).toEqual({});
    expect(profile.links.agentic_api_base).toBe(
      'https://ogabassey.com/api/agentic'
    );
    expect(profile.ucp.capabilities).toMatchObject({
      'com.usebaci.catalog.read': [
        expect.objectContaining({ version: '2026-04-30' }),
      ],
    });
    expect(profile.ucp.capabilities['com.usebaci.catalog.read']).toEqual([
      expect.not.objectContaining({ schema: expect.anything() }),
    ]);
    expect(
      profile.ucp.capabilities['dev.ucp.shopping.checkout']
    ).toBeUndefined();
    expect(profile.ucp.payment_handlers).toEqual({});
    expect(profile.extensions.baci.capabilities).toEqual(['catalog.read']);
  });

  it('maps checkout and order primitives onto native UCP capability declarations', () => {
    const manifest = buildSignedCheckoutManifest();

    const profile = buildUcpDiscoveryProfile(manifest);

    expect(profile.ucp.services).toEqual({
      'dev.ucp.shopping': [
        {
          endpoint: 'https://ogabassey.com/api/agentic',
          schema:
            'https://ucp.dev/2026-04-08/services/shopping/rest.openapi.json',
          spec: 'https://ucp.dev/2026-04-08/specification/overview',
          transport: 'rest',
          version: '2026-04-08',
        },
      ],
    });
    expect(profile.ucp.capabilities['dev.ucp.shopping.checkout']).toEqual([
      expect.objectContaining({
        version: '2026-04-08',
        spec: 'https://ucp.dev/2026-04-08/specification/checkout',
        schema: 'https://ucp.dev/2026-04-08/schemas/shopping/checkout.json',
        config: expect.objectContaining({
          auth: {
            supported_api_versions: ['2026-04-30', '2026-04-01'],
            type: 'bearer_hmac',
          },
          rest: {
            endpoint: 'https://ogabassey.com/api/agentic',
            operations: {
              cancel_checkout:
                'https://ogabassey.com/api/agentic/checkout-sessions/{id}/cancel',
              complete_checkout:
                'https://ogabassey.com/api/agentic/checkout-sessions/{id}/complete',
              create_checkout:
                'https://ogabassey.com/api/agentic/checkout-sessions',
              get_checkout:
                'https://ogabassey.com/api/agentic/checkout-sessions/{id}',
              update_checkout:
                'https://ogabassey.com/api/agentic/checkout-sessions/{id}',
            },
          },
        }),
      }),
    ]);
    expect(profile.ucp.capabilities['dev.ucp.shopping.order']).toEqual([
      expect.objectContaining({
        version: '2026-04-08',
        spec: 'https://ucp.dev/2026-04-08/specification/order',
        schema: 'https://ucp.dev/2026-04-08/schemas/shopping/order.json',
        config: {
          auth: {
            supported_api_versions: ['2026-04-30', '2026-04-01'],
            type: 'bearer_hmac',
          },
          rest: {
            endpoint: 'https://ogabassey.com/api/agentic',
            operations: {
              get_order: 'https://ogabassey.com/api/agentic/orders/{id}',
            },
          },
        },
      }),
    ]);
    expect(profile.ucp.payment_handlers).toMatchObject({
      'com.paystack.bank_transfer': [
        expect.objectContaining({ id: 'paystack_bank_transfer' }),
      ],
    });
    expect(profile.extensions.baci.capabilities).toContain(
      'checkout.session.complete'
    );
    expect(profile.extensions.baci.capabilities).toContain('order.read');
    expect(profile.extensions.baci.auth).toMatchObject({
      type: 'bearer_hmac',
    });
    expect(profile.extensions.baci.links.checkout_sessions).toBe(
      'https://ogabassey.com/api/agentic/checkout_sessions'
    );
    expect(profile.extensions.baci.links.order).toBe(
      'https://ogabassey.com/api/agentic/orders/{order_id}'
    );
  });

  it('advertises UCP cart operations when checkout is enabled', () => {
    const profile = buildUcpDiscoveryProfile(buildSignedCheckoutManifest());

    expect(profile.ucp.capabilities['dev.ucp.shopping.cart']).toEqual([
      expect.objectContaining({
        version: '2026-04-08',
        spec: 'https://ucp.dev/2026-04-08/specification/cart',
        config: expect.objectContaining({
          auth: {
            supported_api_versions: ['2026-04-30', '2026-04-01'],
            type: 'bearer_hmac',
          },
          rest: {
            endpoint: 'https://ogabassey.com/api/agentic',
            operations: {
              cancel_cart:
                'https://ogabassey.com/api/agentic/carts/{id}/cancel',
              convert_cart_to_checkout:
                'https://ogabassey.com/api/agentic/carts/{id}/checkout',
              create_cart: 'https://ogabassey.com/api/agentic/carts',
              get_cart: 'https://ogabassey.com/api/agentic/carts/{id}',
              update_cart: 'https://ogabassey.com/api/agentic/carts/{id}',
            },
          },
        }),
      }),
    ]);
  });

  it('advertises UCP catalog search and lookup operations for signed agents', () => {
    const profile = buildUcpDiscoveryProfile(buildSignedCheckoutManifest());

    expect(profile.ucp.capabilities['dev.ucp.shopping.catalog.search']).toEqual(
      [
        expect.objectContaining({
          config: {
            auth: {
              supported_api_versions: ['2026-04-30', '2026-04-01'],
              type: 'bearer_hmac',
            },
            rest: {
              endpoint: 'https://ogabassey.com/api/agentic',
              operations: {
                search_catalog:
                  'https://ogabassey.com/api/agentic/catalog/search',
              },
            },
          },
        }),
      ]
    );
    const lookupCapability = profile.ucp.capabilities[
      'dev.ucp.shopping.catalog.lookup'
    ]?.[0] as { config: { rest: { operations: Record<string, string> } } };

    expect(lookupCapability.config.rest.operations).toMatchObject({
      get_product: 'https://ogabassey.com/api/agentic/catalog/product',
      lookup_catalog: 'https://ogabassey.com/api/agentic/catalog/lookup',
    });
  });

  it('handles empty Baci capabilities and pay-on-delivery without checkout auth', () => {
    const manifest: AgentCommerceManifest = {
      ...baseManifest,
      capabilities: [],
      payment_methods: ['pay_on_delivery'],
    };

    const profile = buildUcpDiscoveryProfile(manifest);

    expect(
      profile.ucp.capabilities['dev.ucp.shopping.checkout']
    ).toBeUndefined();
    expect(
      profile.ucp.capabilities['com.usebaci.catalog.read']
    ).toBeUndefined();
    expect(profile.ucp.payment_handlers).toMatchObject({
      'com.usebaci.pay_on_delivery': [
        expect.objectContaining({
          id: 'pay_on_delivery',
          spec: 'https://ogabassey.com/agent-commerce.json',
        }),
      ],
    });
    expect(profile.extensions.baci.capabilities).toEqual([]);
    expect(profile.extensions.baci.auth).toBeNull();
  });
});
