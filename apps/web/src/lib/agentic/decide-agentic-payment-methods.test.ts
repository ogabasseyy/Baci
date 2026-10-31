// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { decideAgenticPaymentMethods } from '@/lib/agentic/decide-agentic-payment-methods';

vi.mock('server-only', () => ({}));

type PaymentMerchant = Parameters<typeof decideAgenticPaymentMethods>[0];

const CONFIGURED: PaymentMerchant = {
  feature_settings: { pay_on_delivery_enabled: true },
  paystack_subaccount_code: 'ACCT_TESTMOCK1234567',
};

function stubBaseEnv() {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example.com');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('PAYSTACK_SECRET_KEY', 'paystack-secret');
}

function stubPaystackGooglePay() {
  vi.stubEnv('BACI_GOOGLE_PAY_ENABLED', 'true');
  vi.stubEnv('BACI_GOOGLE_PAY_GATEWAY', 'paystack');
  vi.stubEnv('BACI_GOOGLE_PAY_GATEWAY_MERCHANT_ID', 'paystack-merchant-id');
  vi.stubEnv('BACI_GOOGLE_PAY_MERCHANT_ID', 'google-merchant-id');
}

async function decide(merchant: PaymentMerchant = CONFIGURED) {
  const { decideAgenticPaymentMethods } = await import(
    '@/lib/agentic/decide-agentic-payment-methods'
  );
  return decideAgenticPaymentMethods(merchant);
}

describe('decideAgenticPaymentMethods', () => {
  beforeEach(() => {
    vi.resetModules();
    stubBaseEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('readies Paystack bank transfer and pay on delivery when both are configured', async () => {
    expect(await decide()).toEqual([
      { method: 'paystack_bank_transfer', ready: true, reasons: [] },
      {
        method: 'google_pay',
        ready: false,
        reasons: [
          'google_pay_token_charging_unsupported',
          'google_pay_not_configured',
        ],
      },
      { method: 'pay_on_delivery', ready: true, reasons: [] },
    ]);
  });

  it('never readies Google Pay, even with explicit Paystack gateway config, because completion would create a DVA', async () => {
    stubPaystackGooglePay();

    const googlePay = (await decide()).find(
      (decision) => decision.method === 'google_pay'
    );

    expect(googlePay).toEqual({
      method: 'google_pay',
      ready: false,
      reasons: ['google_pay_token_charging_unsupported'],
    });
  });

  it('lists every unmet Google Pay condition independently', async () => {
    vi.stubEnv('AGENTIC_PAYSTACK_DVA_MODE', 'paused');

    const googlePay = (await decide()).find(
      (decision) => decision.method === 'google_pay'
    );

    expect(googlePay?.reasons).toEqual([
      'google_pay_token_charging_unsupported',
      'paystack_dva_paused',
      'google_pay_not_configured',
    ]);
  });

  it('withholds only Paystack bank transfer while DVA is paused', async () => {
    vi.stubEnv('AGENTIC_PAYSTACK_DVA_MODE', 'paused');

    const decisions = await decide();

    expect(decisions[0]).toEqual({
      method: 'paystack_bank_transfer',
      ready: false,
      reasons: ['paystack_dva_paused'],
    });
    expect(
      decisions.filter((decision) => decision.ready).map((d) => d.method)
    ).toEqual(['pay_on_delivery']);
  });

  it('reports a missing Paystack secret, subaccount and pay on delivery separately', async () => {
    vi.stubEnv('PAYSTACK_SECRET_KEY', '');

    const decisions = await decide({
      feature_settings: { pay_on_delivery_enabled: false },
      paystack_subaccount_code: null,
    });

    expect(decisions[0].reasons).toEqual([
      'paystack_secret_missing',
      'paystack_subaccount_missing',
    ]);
    expect(decisions[2]).toEqual({
      method: 'pay_on_delivery',
      ready: false,
      reasons: ['pay_on_delivery_disabled'],
    });
  });

  it('accepts the storefront snapshot subaccount hint when the raw code is omitted', async () => {
    const decisions = await decide({
      feature_settings: { pay_on_delivery_enabled: false },
      paystack_subaccount_code: null,
      paystack_subaccount_configured: true,
    });

    expect(decisions[0]).toEqual({
      method: 'paystack_bank_transfer',
      ready: true,
      reasons: [],
    });
  });
});
