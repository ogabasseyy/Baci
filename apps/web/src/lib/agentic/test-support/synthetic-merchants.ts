import type { buildAgentCommerceManifest } from '@/lib/agentic/agent-commerce-manifest';
import type { AgenticMerchantContext } from '@/lib/agentic/merchant-context';
import type { CachedMerchant } from '@/lib/cached-data';
import { syntheticUuid } from './synthetic-ids';

type SyntheticManifestMerchant = Parameters<
  typeof buildAgentCommerceManifest
>[0];

/** The merchant fields that shared-cart and VAT decisions read. */
type SyntheticMerchantRecord = Pick<
  CachedMerchant,
  | 'business_name'
  | 'country'
  | 'feature_settings'
  | 'id'
  | 'payout_currency'
  | 'paystack_subaccount_code'
  | 'plan_expires_at'
  | 'plan_tier'
  | 'premium_features'
  | 'slug'
  | 'vat_rate'
  | 'vat_registration_status'
>;

export interface SyntheticMerchant {
  readonly baseUrl: string;
  /** What the scoped merchant-context RPC returns for this merchant. */
  readonly context: AgenticMerchantContext;
  /** Namespace for every synthetic id that belongs to this merchant. */
  readonly idNamespace: number;
  /** What `buildAgentCommerceManifest` takes. */
  readonly manifestMerchant: SyntheticManifestMerchant;
  /** The merchants-table fields behind shared cart and VAT. */
  readonly record: SyntheticMerchantRecord;
}

function buildSyntheticMerchant({
  businessName,
  domain,
  idNamespace,
  paystackSubaccountCode,
  payOnDelivery,
  premiumFeatures,
  slug,
  vatRegistrationStatus,
}: {
  businessName: string;
  domain: string;
  idNamespace: number;
  paystackSubaccountCode: string;
  payOnDelivery: boolean;
  premiumFeatures: string[];
  slug: string;
  vatRegistrationStatus: 'not_registered' | 'registered';
}): SyntheticMerchant {
  const id = syntheticUuid(idNamespace, 0);
  const featureSettings = {
    agentic_checkout_enabled: true,
    pay_on_delivery_enabled: payOnDelivery,
  };
  return {
    baseUrl: `https://${domain}`,
    context: {
      agent_user_agent_allowlist: [],
      agent_user_agent_denylist: [],
      agentic_checkout_enabled: true,
      business_name: businessName,
      custom_domain: domain,
      id,
      pay_on_delivery_enabled: payOnDelivery,
      paystack_subaccount_code: paystackSubaccountCode,
      slug,
    },
    idNamespace,
    manifestMerchant: {
      business_name: businessName,
      feature_settings: featureSettings,
      paystack_subaccount_code: paystackSubaccountCode,
      slug,
    },
    record: {
      business_name: businessName,
      country: 'NG',
      feature_settings: featureSettings,
      id,
      payout_currency: 'NGN',
      paystack_subaccount_code: paystackSubaccountCode,
      plan_expires_at: null,
      plan_tier: 'pro',
      premium_features: premiumFeatures,
      slug,
      // A rate is stored for every merchant; only registration turns VAT on.
      vat_rate: 7.5,
      vat_registration_status: vatRegistrationStatus,
    },
  };
}

/** VAT registered and enrolled in shared cart. */
export const SYNTHETIC_MERCHANT_A: SyntheticMerchant = buildSyntheticMerchant({
  businessName: 'Synthetic Alpha Store',
  domain: 'alpha.synthetic.test',
  idNamespace: 0xa,
  paystackSubaccountCode: 'ACCT_SYNTHALPHA00001',
  payOnDelivery: true,
  premiumFeatures: ['shared_cart'],
  slug: 'synthetic-alpha',
  vatRegistrationStatus: 'registered',
});

/** Not VAT registered and not enrolled in shared cart. */
export const SYNTHETIC_MERCHANT_B: SyntheticMerchant = buildSyntheticMerchant({
  businessName: 'Synthetic Bravo Store',
  domain: 'bravo.synthetic.test',
  idNamespace: 0xb,
  paystackSubaccountCode: 'ACCT_SYNTHBRAVO00002',
  payOnDelivery: false,
  premiumFeatures: [],
  slug: 'synthetic-bravo',
  vatRegistrationStatus: 'not_registered',
});
