import { afterEach, jest } from '@jest/globals';
import {
  DEFAULT_FALLBACK_VAT_RATE_PERCENT,
  FALLBACK_VAT_RATE_ENV,
} from '@/constants/tax';
import { supabase } from '@/lib/supabase';
import {
  fetchMerchantPaymentSettings,
  getEnabledPaymentMethods,
  getMerchantTaxRate,
  merchantPaymentSettingsQueryKey,
  normalizePaymentSettings,
} from './useMerchantPaymentSettings';

jest.mock('expo-constants', () => ({
  expoConfig: {
    extra: {
      merchantId: 'merchant-test-id',
    },
  },
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
  },
}));

describe('getEnabledPaymentMethods', () => {
  it('never advertises retired CredPal even if saved settings enable it', () => {
    const settings = normalizePaymentSettings({
      credpal_enabled: true,
      credit_direct_enabled: true,
    });
    expect(settings.credpal_enabled).toBe(false);
    expect(getEnabledPaymentMethods(settings)).not.toContain('credpal');
    expect(getEnabledPaymentMethods(settings)).toContain('credit_direct');
  });

  it('keeps the safe fallback when payment settings are unavailable', () => {
    expect(getEnabledPaymentMethods(undefined)).toEqual(['paystack']);
  });

  it('includes Klump only when the merchant has explicitly enabled it', () => {
    const methods = getEnabledPaymentMethods({
      paystack_enabled: true,
      korapay_enabled: false,
      juicyway_enabled: false,
      pay_on_delivery_enabled: false,
      credpal_enabled: false,
      credit_direct_enabled: false,
      klump_enabled: true,
      wallet_paystack_dva_enabled: false,
    } as never);

    expect(methods).toEqual(['paystack', 'klump']);
  });
});

describe('normalizePaymentSettings', () => {
  const originalFallbackVatRate = process.env[FALLBACK_VAT_RATE_ENV];

  afterEach(() => {
    if (originalFallbackVatRate === undefined) {
      delete process.env[FALLBACK_VAT_RATE_ENV];
    } else {
      process.env[FALLBACK_VAT_RATE_ENV] = originalFallbackVatRate;
    }
  });

  it.each([
    null,
    undefined,
    42,
    { nested: { malformed: true } },
  ])('normalizes unavailable or malformed settings %p to safe defaults', (settings) => {
    expect(normalizePaymentSettings(settings as never)).toMatchObject({
      klump_max_amount: 0,
      klump_min_amount: 0,
      paystack_enabled: true,
      vat_rate: DEFAULT_FALLBACK_VAT_RATE_PERCENT,
      wallet_order_auto_debit_enabled: false,
      wallet_paystack_dva_enabled: false,
    });
  });

  it('normalizes missing wallet DVA fields to false during staged deploys', () => {
    expect(
      normalizePaymentSettings({
        paystack_enabled: true,
      })
    ).toMatchObject({
      paystack_enabled: true,
      wallet_order_auto_debit_enabled: false,
      wallet_paystack_dva_enabled: false,
    });
  });

  it('normalizes malformed numeric payment settings to safe defaults', () => {
    expect(
      normalizePaymentSettings({
        klump_max_amount: Number.NaN,
        klump_min_amount: 'invalid' as never,
        vat_rate: Number.POSITIVE_INFINITY,
      })
    ).toMatchObject({
      klump_max_amount: 0,
      klump_min_amount: 0,
      vat_rate: DEFAULT_FALLBACK_VAT_RATE_PERCENT,
    });
  });

  it('rejects negative VAT rates and falls back to the configured default', () => {
    expect(
      normalizePaymentSettings({
        vat_rate: -5,
      })
    ).toMatchObject({
      vat_rate: DEFAULT_FALLBACK_VAT_RATE_PERCENT,
    });
  });

  it('falls back when numeric helpers receive values that throw during parsing', () => {
    const throwingValue = {
      valueOf() {
        throw new Error('cannot coerce');
      },
    };

    expect(
      normalizePaymentSettings({
        klump_min_amount: throwingValue as never,
        vat_rate: throwingValue as never,
      })
    ).toMatchObject({
      klump_min_amount: 0,
      vat_rate: DEFAULT_FALLBACK_VAT_RATE_PERCENT,
    });
  });

  it('reads fallback VAT lazily so tests and runtime config can set it before normalization', () => {
    process.env[FALLBACK_VAT_RATE_ENV] = '5';

    expect(normalizePaymentSettings(null).vat_rate).toBe(5);
    expect(
      getMerchantTaxRate({
        ...normalizePaymentSettings(null),
        vat_registration_status: 'registered',
        vat_rate: undefined as never,
      })
    ).toBe(0.05);
  });

  it('keeps bank transfer behind the explicit Paystack DVA flag', () => {
    const settings = normalizePaymentSettings({
      paystack_enabled: true,
      wallet_order_auto_debit_enabled: true,
      wallet_paystack_dva_enabled: false,
    });

    expect(getEnabledPaymentMethods(settings)).not.toContain('bank_transfer');
    expect(settings.wallet_order_auto_debit_enabled).toBe(true);
    expect(settings.wallet_paystack_dva_enabled).toBe(false);
  });

  it('enables bank transfer when Paystack DVA is explicitly enabled', () => {
    const settings = normalizePaymentSettings({
      paystack_enabled: true,
      wallet_order_auto_debit_enabled: true,
      wallet_paystack_dva_enabled: true,
    });

    expect(getEnabledPaymentMethods(settings)).toContain('bank_transfer');
    expect(settings.wallet_order_auto_debit_enabled).toBe(true);
    expect(settings.wallet_paystack_dva_enabled).toBe(true);
  });
});

describe('merchant payment settings query', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('exports the same stable key used to warm checkout payment options', () => {
    expect(merchantPaymentSettingsQueryKey).toEqual([
      'merchant-payment-settings',
      'merchant-test-id',
    ]);
  });

  it('fetches and normalizes merchant payment settings for React Query prefetching', async () => {
    const single = jest.fn(async () => ({
      data: {
        klump_enabled: true,
        paystack_enabled: false,
        vat_rate: '7.5',
        vat_registration_status: 'registered',
      },
      error: null,
    }));
    (supabase.rpc as jest.Mock).mockReturnValue({ single });

    await expect(fetchMerchantPaymentSettings()).resolves.toMatchObject({
      klump_enabled: true,
      paystack_enabled: false,
      vat_rate: 7.5,
      vat_registration_status: 'registered',
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'get_storefront_payment_settings',
      { p_merchant_id: 'merchant-test-id' }
    );
    expect(single).toHaveBeenCalledTimes(1);
  });

  it('throws RPC errors so React Query can retry or surface the fallback path', async () => {
    const rpcError = new Error('rpc failed');
    const single = jest.fn(async () => ({ data: null, error: rpcError }));
    (supabase.rpc as jest.Mock).mockReturnValue({ single });

    await expect(fetchMerchantPaymentSettings()).rejects.toThrow(rpcError);
  });
});
