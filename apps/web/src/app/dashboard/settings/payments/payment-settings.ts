// Payment-settings defaults + fetch normalization for the dashboard payments
// page. Extracted from page.tsx so the oversized page component does not carry
// this logic and the null-default normalization is independently testable.

export interface PaymentGatewaySettings {
  paystack_enabled: boolean;
  korapay_enabled: boolean;
  pay_on_delivery_enabled: boolean;
  preferred_local_gateway: 'paystack' | 'korapay';
  preferred_international_gateway: 'paystack' | 'korapay';
  // Credit Direct BNPL
  credit_direct_enabled: boolean;
  // Oxygen BNPL
  oxygen_enabled: boolean;
}

/** Shape of the raw `/api/merchant/features` payload we read here. */
interface RawPaymentSettings {
  paystack_enabled?: boolean | null;
  korapay_enabled?: boolean | null;
  pay_on_delivery_enabled?: boolean | null;
  preferred_local_gateway?: string | null;
  preferred_international_gateway?: string | null;
  credit_direct_enabled?: boolean | null;
  oxygen_enabled?: boolean | null;
}

// Korapay is opt-in (default OFF) — consistent with the checkout gate and the
// merchant_feature_settings default. The toggle shows OFF until explicitly enabled.
export const DEFAULT_PAYMENT_SETTINGS: PaymentGatewaySettings = {
  paystack_enabled: true,
  korapay_enabled: false,
  pay_on_delivery_enabled: false,
  preferred_local_gateway: 'paystack',
  preferred_international_gateway: 'korapay',
  credit_direct_enabled: false,
  oxygen_enabled: false,
};

function coerceGateway(
  value: string | null | undefined,
  fallback: 'paystack' | 'korapay'
): 'paystack' | 'korapay' {
  return value === 'paystack' || value === 'korapay' ? value : fallback;
}

/**
 * Normalize the `/api/merchant/features` payload into typed settings. Korapay
 * defaults OFF on a null/absent flag (opt-in), matching the checkout gate and
 * the merchant_feature_settings default; Paystack stays default ON.
 */
export function normalizePaymentSettings(
  data: RawPaymentSettings
): PaymentGatewaySettings {
  return {
    paystack_enabled: data.paystack_enabled ?? true,
    korapay_enabled: data.korapay_enabled ?? false,
    pay_on_delivery_enabled: data.pay_on_delivery_enabled ?? false,
    preferred_local_gateway: coerceGateway(
      data.preferred_local_gateway,
      'paystack'
    ),
    preferred_international_gateway: coerceGateway(
      data.preferred_international_gateway,
      'korapay'
    ),
    credit_direct_enabled: data.credit_direct_enabled ?? false,
    oxygen_enabled: data.oxygen_enabled ?? false,
  };
}
