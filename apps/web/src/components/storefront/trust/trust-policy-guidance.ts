import type { MerchantTrustProfile } from '@/lib/storefront-trust/merchant-trust-profile-types';
import type { TrustPolicyKind } from './trust-policy-page-client';

function hasConfiguredReturnPolicy(
  trustProfile: MerchantTrustProfile
): boolean {
  const returnPolicy = trustProfile.returnPolicy;
  return Boolean(
    returnPolicy &&
      (returnPolicy.summary?.trim() ||
        returnPolicy.windowDays != null ||
        returnPolicy.returnMethod ||
        returnPolicy.returnFees)
  );
}

export function getPolicyGuidance(
  kind: TrustPolicyKind,
  merchantName: string,
  trustProfile: MerchantTrustProfile
): { heading: string; paragraphs: string[] } {
  switch (kind) {
    case 'returns': {
      if (!hasConfiguredReturnPolicy(trustProfile)) {
        return {
          heading: 'Before you contact support about a return',
          paragraphs: [
            `Return details for ${merchantName} are not fully specified on this page yet. Contact support before sending any item back so the team can confirm eligibility, required evidence and the correct return address or process.`,
            'Keep your order number, receipt, product photos and packaging information available. Clear details help support confirm the next step without creating return instructions that are not backed by the merchant policy.',
          ],
        };
      }

      return {
        heading: 'Before you request a return',
        paragraphs: [
          `Use this page to confirm the current return window, accepted return method and any return fees before sending an item back to ${merchantName}. Keep the order number, receipt, original accessories and product packaging ready so support can verify the request quickly.`,
          'Inspect the item as soon as it arrives. Report defects or delivery damage early, keep product packaging where possible, and contact support before dispatching anything to prevent avoidable delays.',
        ],
      };
    }
    case 'shipping':
      return {
        heading: 'How delivery works',
        paragraphs: [
          `Use this page to confirm the delivery regions, handling time, transit estimate and shipping fee method for ${merchantName}. Delivery timing can depend on stock status, payment confirmation, destination city and courier availability.`,
          'Before checkout, confirm the exact delivery address, recipient phone number and selected product variant. For high-value orders, keep the order reference available and inspect the package at delivery before accepting it where possible.',
        ],
      };
    case 'warranty':
      return {
        heading: 'How warranty support works',
        paragraphs: [
          `Use this page to confirm the warranty coverage available from ${merchantName} before you complete a purchase or request service support. Read the published coverage and exclusions, and contact support if you need clarification for your device.`,
          'Keep your order receipt, product identifier where applicable and photos or videos showing the fault. Support can explain the claim process and the coverage stated in the published warranty policy.',
        ],
      };
  }
}
