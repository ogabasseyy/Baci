import { expect, it } from 'vitest';
import { journeyContextSchema } from '@/schemas/merchant-onboarding-email';
import { toOnboardingContext } from './context';
import { decideOnboardingEmail } from './policy';

it('uses the same enable-payment action as dashboard readiness when a configured Paystack account is disabled', () => {
  const context = journeyContextSchema.parse({
    merchant_id: '20000000-0000-4000-8000-000000000001',
    email: 'owner@example.com',
    business_name: 'Store',
    confirmed: true,
    enabled: true,
    reply_to: 'help@example.com',
    opt_out_token: '30000000-0000-4000-8000-000000000001',
    is_published: false,
    provisioned: true,
    slug: 'store',
    country: 'NG',
    payout_currency: 'NGN',
    has_contact: true,
    bank_configured: true,
    paystack_configured: true,
    feature_settings: {
      paystack_enabled: false,
      korapay_enabled: false,
      pay_on_delivery_enabled: false,
    },
    identity_verified: true,
    active_product_count: 1,
  });
  expect(
    decideOnboardingEmail('day3', toOnboardingContext(context))
  ).toMatchObject({
    kind: 'send',
    action: 'Enable a payment method',
    href: '/dashboard/settings/payments',
  });
});
