import type { MerchantTrustProfileDraft } from '@baci/shared';
import type { MerchantTrustProfileSource } from './merchant-trust-profile-types';

// Owner-approved on 2026-10-25. Keep this versioned contract shared by policy
// pages, shopping feeds and structured data; do not revive stale template copy.
export const OGABASSEY_RETURN_WINDOW_DAYS = 14;
export const OGABASSEY_RETURN_POLICY_SUMMARY =
  'Ogabassey accepts returns for devices with technical defects that were not disclosed at purchase, within 14 days of delivery. Contact customer support to arrange the return. Return fees and the return method will be confirmed by support.';
export const OGABASSEY_WARRANTY_POLICY_SUMMARY =
  'Devices purchased from Ogabassey have a one-year Ogabassey warranty covering issues not caused by the user. The warranty excludes power surges, screen damage and liquid damage. Ogabassey Assurance device protection plans are separate from this warranty and have their own terms. Contact customer support to make a warranty claim.';
// Owner-confirmed on 2026-11-05: shipping is paid and fulfilled with GIG Logistics.
export const OGABASSEY_SHIPPING_POLICY_SUMMARY =
  'Delivery is handled by GIG Logistics. Shipping is paid, with the delivery fee calculated and confirmed at checkout for your destination. Shipping is not free.';

export function buildOgabasseyApprovedPolicyDraft(
  merchant: MerchantTrustProfileSource
): MerchantTrustProfileDraft {
  const draft = merchant.trust_profile ?? {};
  // A reusable template and request URL are not merchant identity.
  if (merchant.slug !== 'ogabassey') return draft;

  return {
    ...draft,
    return_policy: {
      summary: OGABASSEY_RETURN_POLICY_SUMMARY,
      window_days: OGABASSEY_RETURN_WINDOW_DAYS,
    },
    warranty_policy: { summary: OGABASSEY_WARRANTY_POLICY_SUMMARY },
    shipping_policy: {
      ...draft.shipping_policy,
      summary: OGABASSEY_SHIPPING_POLICY_SUMMARY,
      regions: ['Nigeria'],
      shipping_fee_type: 'calculated',
    },
  };
}
