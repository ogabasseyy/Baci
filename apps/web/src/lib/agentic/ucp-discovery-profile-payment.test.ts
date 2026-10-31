// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { AgentCommerceManifest } from '@/lib/agentic/agent-commerce-manifest';
import { buildUcpDiscoveryProfile } from '@/lib/agentic/ucp-discovery-profile';

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

function buildManifest(
  overrides: Partial<AgentCommerceManifest> = {}
): AgentCommerceManifest {
  return {
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
      agent_native_commerce:
        'https://ogabassey.com/.well-known/agent-native-commerce',
      checkout_session:
        'https://ogabassey.com/api/agentic/checkout_sessions/{session_id}',
      checkout_session_cancel:
        'https://ogabassey.com/api/agentic/checkout_sessions/{session_id}/cancel',
      checkout_session_complete:
        'https://ogabassey.com/api/agentic/checkout_sessions/{session_id}/complete',
      checkout_sessions: 'https://ogabassey.com/api/agentic/checkout_sessions',
      feeds: {
        agent_products: 'https://ogabassey.com/feeds/agent-products.jsonl',
        agent_repairs: 'https://ogabassey.com/feeds/agent-repairs.jsonl',
        facebook_catalog_xml: 'https://ogabassey.com/feeds/facebook.xml',
        facebook_repairs_xml:
          'https://ogabassey.com/feeds/facebook-repairs.xml',
        google_merchant_xml: 'https://ogabassey.com/feeds/google-merchant.xml',
      },
      llms: 'https://ogabassey.com/llms.txt',
      llms_full: 'https://ogabassey.com/llms-full.txt',
      order: 'https://ogabassey.com/api/agentic/orders/{order_id}',
      product_api: 'https://ogabassey.com/api/storefront/ogabassey/products',
      product_feed: 'https://ogabassey.com/feeds/openai.jsonl',
      privacy_policy_url: 'https://ogabassey.com/privacy',
      return_policy_url: 'https://ogabassey.com/returns',
      shipping_policy_url: 'https://ogabassey.com/shipping',
      terms_of_service_url: 'https://ogabassey.com/terms',
      trust: 'https://ogabassey.com/agent-trust.json',
    },
    payment_methods: ['paystack_bank_transfer'],
    platform: 'baci',
    schema_version: '2026-04-30',
    store: {
      canonical_origin: 'https://ogabassey.com',
      name: 'Ogabassey',
      slug: 'ogabassey',
    },
    ...overrides,
  };
}

describe('buildUcpDiscoveryProfile payment handlers', () => {
  it('does not advertise Google Pay when processor config is absent', () => {
    const profile = buildUcpDiscoveryProfile(
      buildManifest({
        payment_methods: ['paystack_bank_transfer', 'google_pay' as never],
      })
    );

    expect(profile.ucp.payment_handlers).not.toHaveProperty('com.google.pay');
  });

  it('never emits a com.google.pay handler, even if a manifest lists google_pay', () => {
    const profile = buildUcpDiscoveryProfile(
      buildManifest({
        payment_methods: ['paystack_bank_transfer', 'google_pay'],
      })
    );

    expect(profile.ucp.payment_handlers).not.toHaveProperty('com.google.pay');
    expect(profile.ucp.payment_handlers).toHaveProperty(
      'com.paystack.bank_transfer'
    );
  });

  it('does not advertise AP2 mandate support without an AP2 verifier', () => {
    const profile = buildUcpDiscoveryProfile(buildManifest());

    expect(profile.ucp.capabilities).not.toHaveProperty(
      'dev.ucp.shopping.ap2_mandate'
    );
  });
});
