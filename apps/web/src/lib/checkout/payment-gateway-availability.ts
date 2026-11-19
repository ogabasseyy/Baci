export interface CheckoutPaymentMerchant {
  bank_account_number?: string | null;
  bank_code?: string | null;
  country?: string | null;
  payout_currency?: string | null;
  paystack_subaccount_code?: string | null;
  /**
   * Derived capability hint from the public merchant snapshot. The raw
   * subaccount code never crosses the anonymous boundary, so storefront
   * merchants carry this boolean instead.
   */
  paystack_subaccount_configured?: boolean | null;
  feature_settings?: unknown;
}

export interface LaunchPaymentRequirement {
  id: 'bank_account' | 'payment_method';
  label: string;
  description: string;
  completed: boolean;
}

const KORAPAY_CHECKOUT_CURRENCIES = new Set([
  'NGN',
  'KES',
  'GHS',
  'ZAR',
  'XAF',
  'XOF',
]);

function readBooleanSetting(
  settings: unknown,
  key: string
): boolean | undefined {
  const normalizedSettings = Array.isArray(settings) ? settings[0] : settings;
  if (
    !normalizedSettings ||
    typeof normalizedSettings !== 'object' ||
    Array.isArray(normalizedSettings)
  ) {
    return undefined;
  }

  const value = (normalizedSettings as Record<string, unknown>)[key];
  return typeof value === 'boolean' ? value : undefined;
}

function readPaystackEnabled(settings: unknown): boolean | undefined {
  return readBooleanSetting(settings, 'paystack_enabled');
}

function readKorapayEnabled(settings: unknown): boolean | undefined {
  return readBooleanSetting(settings, 'korapay_enabled');
}

function readPayOnDeliveryEnabled(settings: unknown): boolean | undefined {
  return readBooleanSetting(settings, 'pay_on_delivery_enabled');
}

function readWalletPaystackDvaEnabled(settings: unknown): boolean | undefined {
  return readBooleanSetting(settings, 'wallet_paystack_dva_enabled');
}

function normalizePaymentCountryCode(
  country: string | null | undefined
): string | null {
  const trimmed = country?.trim();
  return trimmed ? trimmed.toUpperCase() : null;
}

export function isBaciPaystackSettlementCountry(
  country: string | null | undefined
): boolean {
  const normalizedCountry = normalizePaymentCountryCode(country);
  return normalizedCountry === null || normalizedCountry === 'NG';
}

export function isPaystackCheckoutAvailable(
  merchant: CheckoutPaymentMerchant | null | undefined
): boolean {
  if (!merchant) return false;
  if (!isBaciPaystackSettlementCountry(merchant.country)) return false;
  if (readPaystackEnabled(merchant.feature_settings) === false) return false;
  return (
    Boolean(merchant.paystack_subaccount_code?.trim()) ||
    merchant.paystack_subaccount_configured === true
  );
}

export function isKorapayCheckoutCurrencySupported(
  currency: string | null | undefined
): boolean {
  const normalizedCurrency = currency?.trim().toUpperCase();
  return Boolean(
    normalizedCurrency && KORAPAY_CHECKOUT_CURRENCIES.has(normalizedCurrency)
  );
}

export function isKorapayCheckoutAvailable(
  merchant: CheckoutPaymentMerchant | null | undefined,
  currency?: string | null
): boolean {
  if (!merchant) return false;
  if (currency != null && !isKorapayCheckoutCurrencySupported(currency)) {
    return false;
  }
  return readKorapayEnabled(merchant.feature_settings) === true;
}

export function isPayOnDeliveryCheckoutAvailable(
  merchant: CheckoutPaymentMerchant | null | undefined
): boolean {
  if (!merchant) return false;
  return readPayOnDeliveryEnabled(merchant.feature_settings) === true;
}

// Bank transfer checkout currently provisions a Paystack DVA, so it must track
// the same availability gate until we add a separate bank-transfer capability.
export function isBankTransferCheckoutAvailable(
  merchant: CheckoutPaymentMerchant | null | undefined
): boolean {
  if (!isPaystackCheckoutAvailable(merchant)) return false;
  return readWalletPaystackDvaEnabled(merchant?.feature_settings) === true;
}

function hasPaystackSettlementDetails(
  merchant: CheckoutPaymentMerchant | null | undefined
): boolean {
  if (!merchant) return false;
  return Boolean(
    isPaystackCheckoutAvailable(merchant) &&
      merchant.bank_account_number?.trim() &&
      merchant.bank_code?.trim()
  );
}

function hasKorapayLaunchCheckout(
  merchant: CheckoutPaymentMerchant | null | undefined
): boolean {
  const currency = merchant?.payout_currency;
  return Boolean(
    isKorapayCheckoutAvailable(merchant, currency) &&
      isKorapayCheckoutCurrencySupported(currency)
  );
}

export function hasLaunchablePaymentMethod(
  merchant: CheckoutPaymentMerchant | null | undefined
): boolean {
  return (
    hasPaystackSettlementDetails(merchant) ||
    hasKorapayLaunchCheckout(merchant) ||
    isPayOnDeliveryCheckoutAvailable(merchant)
  );
}

export function requiresNigerianKycForLaunch(
  merchant: CheckoutPaymentMerchant | null | undefined
): boolean {
  if (!merchant) return false;
  if (hasPaystackSettlementDetails(merchant)) return true;
  return isBaciPaystackSettlementCountry(merchant.country);
}

export function getLaunchPaymentRequirement(
  merchant: CheckoutPaymentMerchant | null | undefined
): LaunchPaymentRequirement {
  if (hasPaystackSettlementDetails(merchant)) {
    return {
      id: 'bank_account',
      label: 'Add bank account',
      description: 'Required to receive payments via Paystack',
      completed: true,
    };
  }

  if (isPayOnDeliveryCheckoutAvailable(merchant)) {
    return {
      id: 'payment_method',
      label: 'Enable a payment method',
      description: 'Pay on Delivery is enabled for customer checkout',
      completed: true,
    };
  }

  if (hasKorapayLaunchCheckout(merchant)) {
    return {
      id: 'payment_method',
      label: 'Enable a payment method',
      description: 'Korapay is enabled for customer checkout',
      completed: true,
    };
  }

  if (!merchant || isBaciPaystackSettlementCountry(merchant.country)) {
    return {
      id: 'bank_account',
      label: 'Add bank account',
      description: 'Required to receive payments via Paystack',
      completed: false,
    };
  }

  return {
    id: 'payment_method',
    label: 'Enable a payment method',
    description: 'Enable Pay on Delivery or request an online payment provider',
    completed: false,
  };
}

/** Shared readiness wording for a configured but disabled payment method. */
export function getReadinessLaunchPaymentRequirement(
  merchant: CheckoutPaymentMerchant
): LaunchPaymentRequirement {
  const requirement = getLaunchPaymentRequirement(merchant);
  if (
    requirement.id === 'bank_account' &&
    !requirement.completed &&
    merchant.bank_account_number?.trim() &&
    merchant.bank_code?.trim() &&
    (Boolean(merchant.paystack_subaccount_code?.trim()) ||
      merchant.paystack_subaccount_configured === true) &&
    readPaystackEnabled(merchant.feature_settings) === false &&
    readPayOnDeliveryEnabled(merchant.feature_settings) !== true
  ) {
    return {
      id: 'payment_method',
      label: 'Enable a payment method',
      description: 'Enable Paystack or Pay on Delivery for customer checkout',
      completed: false,
    };
  }
  return requirement;
}
