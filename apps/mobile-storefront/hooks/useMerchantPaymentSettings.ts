import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import type { PaymentMethodType } from '@/components/checkout/PaymentMethodSelector';
import { resolveFallbackVatRate } from '@/constants/tax';
import { supabase } from '@/lib/supabase';

const MERCHANT_ID =
  Constants.expoConfig?.extra?.merchantId ||
  '6b5cb8a4-5575-456c-b936-8cdfae30db74';
export const merchantPaymentSettingsQueryKey = [
  'merchant-payment-settings',
  MERCHANT_ID,
] as const;

export interface PaymentSettings {
  paystack_enabled: boolean;
  korapay_enabled: boolean;
  juicyway_enabled: boolean;
  credpal_enabled: boolean;
  credit_direct_enabled: boolean;
  klump_enabled: boolean;
  klump_min_amount: number;
  klump_max_amount: number;
  pay_on_delivery_enabled: boolean;
  wallet_order_auto_debit_enabled: boolean;
  wallet_paystack_dva_enabled: boolean;
  vat_registration_status: string;
  /** VAT rate as a percentage, for example 7.5 for 7.5%. */
  vat_rate: number;
  /**
   * Live merchant shipping-insurance toggle. The cart assurance default
   * reads this from the query cache: only an affirmative true defaults
   * Ogabassey lines on, so fail-closed normalization (=== true) here
   * keeps unknown/missing values opt-out.
   */
  shipping_insurance_enabled: boolean;
}

function safeNumber(value: unknown, fallback: number): number {
  if (value === null || value === undefined) {
    return fallback;
  }
  try {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : fallback;
  } catch {
    return fallback;
  }
}

function safeNonNegativeNumber(value: unknown, fallback: number): number {
  const numericValue = safeNumber(value, fallback);
  return numericValue >= 0 ? numericValue : fallback;
}

function isPaymentSettingsRow(
  value: unknown
): value is Partial<PaymentSettings> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function normalizePaymentSettings(
  row: Partial<PaymentSettings> | null | undefined
): PaymentSettings {
  const fallbackVatRatePercent = resolveFallbackVatRate();

  return {
    paystack_enabled: row?.paystack_enabled !== false,
    korapay_enabled: row?.korapay_enabled === true,
    juicyway_enabled: row?.juicyway_enabled === true,
    credpal_enabled: row?.credpal_enabled === true,
    credit_direct_enabled: row?.credit_direct_enabled === true,
    klump_enabled: row?.klump_enabled === true,
    klump_min_amount: safeNumber(row?.klump_min_amount, 0),
    klump_max_amount: safeNumber(row?.klump_max_amount, 0),
    pay_on_delivery_enabled: row?.pay_on_delivery_enabled === true,
    wallet_order_auto_debit_enabled:
      row?.wallet_order_auto_debit_enabled === true,
    wallet_paystack_dva_enabled: row?.wallet_paystack_dva_enabled === true,
    vat_registration_status: row?.vat_registration_status ?? 'unregistered',
    vat_rate: safeNonNegativeNumber(row?.vat_rate, fallbackVatRatePercent),
    shipping_insurance_enabled: row?.shipping_insurance_enabled === true,
  };
}

/**
 * Fetch merchant payment settings via SECURITY DEFINER RPC.
 * Bypasses RLS so anon/customer sessions can read payment toggles.
 */
export async function fetchMerchantPaymentSettings(): Promise<PaymentSettings> {
  const { data, error } = await supabase
    .rpc('get_storefront_payment_settings', {
      p_merchant_id: MERCHANT_ID,
    })
    .single();

  if (error) throw error;
  return normalizePaymentSettings(isPaymentSettingsRow(data) ? data : null);
}

/**
 * Freshness window for the payment-settings cache. The persisted cache
 * restores up to 24h-old successes across sessions; assurance reads
 * (add-time default, pending reconciliation) treat data older than this
 * as unknown so a merchant toggle change cannot charge a withdrawn
 * service from a stale restore. Single source: the query staleTime
 * below and the synchronous cache readers share it.
 */
export const MERCHANT_PAYMENT_SETTINGS_STALE_MS = 5 * 60 * 1000;

export function useMerchantPaymentSettings() {
  return useQuery({
    queryKey: merchantPaymentSettingsQueryKey,
    queryFn: fetchMerchantPaymentSettings,
    staleTime: MERCHANT_PAYMENT_SETTINGS_STALE_MS,
  });
}

/**
 * Get the tax rate for order calculations.
 * Returns 0 if merchant is not VAT-registered, otherwise the merchant's rate as a decimal.
 */
export function getMerchantTaxRate(
  settings: PaymentSettings | undefined | null
): number {
  if (settings?.vat_registration_status !== 'registered') {
    return 0;
  }
  return (settings.vat_rate ?? resolveFallbackVatRate()) / 100;
}

/**
 * Convert settings to an array of enabled PaymentMethodType values.
 *
 * Default behavior (when settings are undefined/null — e.g. RPC fails):
 * - Show paystack card checkout only (safe fallback)
 *
 * The RPC already applies COALESCE defaults matching the web's asymmetric logic:
 * - paystack/korapay: on unless explicitly false
 * - everything else: off unless explicitly true
 */
export function getEnabledPaymentMethods(
  settings: PaymentSettings | undefined | null
): PaymentMethodType[] {
  if (!settings) {
    return ['paystack'];
  }

  const methods: PaymentMethodType[] = [];

  if (settings.paystack_enabled) methods.push('paystack');
  if (settings.korapay_enabled) methods.push('korapay');
  if (settings.juicyway_enabled) methods.push('juicyway');
  if (settings.pay_on_delivery_enabled) methods.push('pay_on_delivery');
  if (settings.credpal_enabled) methods.push('credpal');
  if (settings.credit_direct_enabled) methods.push('credit_direct');
  if (settings.klump_enabled) methods.push('klump');

  // Bank transfer provisions a Paystack DVA, so it must stay explicitly gated.
  if (settings.paystack_enabled && settings.wallet_paystack_dva_enabled) {
    methods.push('bank_transfer');
  }

  return methods;
}
