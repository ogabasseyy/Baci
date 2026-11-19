import {
  getReadinessLaunchPaymentRequirement,
  requiresNigerianKycForLaunch,
} from '@/lib/checkout/payment-gateway-availability';
import type { JourneyContext } from '@/schemas/merchant-onboarding-email';
import type { OnboardingContext } from './policy';
export function toOnboardingContext(
  context: JourneyContext
): OnboardingContext {
  const merchant = {
    country: context.country,
    payout_currency: context.payout_currency,
    bank_account_number: context.bank_configured ? 'configured' : null,
    bank_code: context.bank_configured ? 'configured' : null,
    paystack_subaccount_configured: context.paystack_configured,
    feature_settings: context.feature_settings,
  };
  return {
    confirmed: context.confirmed,
    enabled: context.enabled,
    deliveryEnabled: context.delivery_enabled,
    isPublished: context.is_published,
    provisioned: context.provisioned,
    facts: {
      merchantId: context.merchant_id,
      slug: context.slug,
      country: context.country,
      supportEmail: null,
      supportPhone: null,
      merchantEmail: context.has_contact ? context.email : null,
      merchantPhone: null,
      activeProductCount: context.active_product_count,
      totalProductCount: context.active_product_count,
      kycRequired: requiresNigerianKycForLaunch(merchant),
      hasVerifiedIdentity: context.identity_verified,
      paymentRequirement: getReadinessLaunchPaymentRequirement(merchant),
    },
  };
}
