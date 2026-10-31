import type { buildAgentCommerceManifest } from '@/lib/agentic/agent-commerce-manifest';

// A price with kobo: N39.98 is 3998 minor units. Two of them cost 7996.
export const MAJOR_PRICE = 39.98;
export const UNIT_MINOR = 3998;
export const LINE_MINOR = 7996;

export type ManifestMerchant = Parameters<typeof buildAgentCommerceManifest>[0];

export const MERCHANT: ManifestMerchant = {
  business_name: 'Ogabassey',
  feature_settings: { pay_on_delivery_enabled: true },
  paystack_subaccount_code: 'ACCT_TESTMOCK1234567',
  shared_cart_enabled: true,
  slug: 'ogabassey',
};
