import { toMoneyRouteParam } from '@/components/bnpl-checkout/bnpl-params.schema';
import type {
  SavingsSelection,
  WalletSelection,
} from '@/lib/wallet-payment-helpers';

export interface KlumpPaymentSettings {
  klump_enabled?: boolean | null;
  klump_max_amount?: number | null;
  klump_min_amount?: number | null;
}

const KLUMP_DEFAULT_MAX_AMOUNT = 1_000_000;

interface BuildKlumpInitializePayloadInput {
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  merchantId: string;
  orderId: string;
}

interface BuildKlumpBnplRouteParamsInput {
  amount: number;
  authorizationUrl: string;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  orderId: string;
  reference: string;
  merchantDomain?: string;
  merchantSlug?: string;
  trackingToken?: string | null;
}

export function formatKlumpAmount(amount: number) {
  return `₦${Math.round(amount).toLocaleString('en-US')}`;
}

export function getKlumpDisabledReason(
  settings: KlumpPaymentSettings | undefined | null,
  payableAmount: number,
  _walletSelection?: WalletSelection,
  _savingsSelection?: SavingsSelection
): string | undefined {
  if (!settings?.klump_enabled) {
    return 'Klump is not available for this merchant';
  }

  if (!Number.isFinite(payableAmount) || payableAmount <= 0) {
    return 'No payable balance remains for Klump checkout';
  }

  const minAmount = settings.klump_min_amount ?? 10_000;
  if (payableAmount < minAmount) {
    return `Minimum order: ${formatKlumpAmount(minAmount)}`;
  }

  const maxAmount = settings.klump_max_amount ?? KLUMP_DEFAULT_MAX_AMOUNT;
  if (payableAmount > maxAmount) {
    return `Maximum order: ${formatKlumpAmount(maxAmount)}`;
  }

  return undefined;
}

/**
 * Returns true only when Klump is enabled and the order total exceeds the
 * merchant-configured maximum, falling back to the default max amount when
 * KlumpPaymentSettings does not provide one.
 */
export function shouldHideKlumpPaymentMethod(
  settings: KlumpPaymentSettings | undefined | null,
  orderTotal: number
): boolean {
  if (!settings?.klump_enabled || !Number.isFinite(orderTotal)) {
    return false;
  }

  const maxAmount = settings.klump_max_amount ?? KLUMP_DEFAULT_MAX_AMOUNT;
  return orderTotal > maxAmount;
}

export function buildKlumpInitializePayload({
  customerEmail,
  customerName,
  customerPhone,
  merchantId,
  orderId,
}: BuildKlumpInitializePayloadInput) {
  return {
    currency: 'NGN',
    customer_email: customerEmail,
    customer_name: customerName,
    customer_phone: customerPhone,
    gateway: 'klump',
    merchant_id: merchantId,
    order_id: orderId,
  } as const;
}

export function buildKlumpBnplRouteParams({
  amount,
  authorizationUrl,
  customerEmail,
  customerName,
  customerPhone,
  orderId,
  reference,
  merchantDomain,
  merchantSlug,
  trackingToken,
}: BuildKlumpBnplRouteParamsInput) {
  return {
    amount: toMoneyRouteParam(amount),
    authorizationUrl,
    customerEmail,
    customerName,
    customerPhone,
    gateway: 'klump',
    orderId,
    reference,
    ...(merchantSlug ? { merchantSlug } : {}),
    ...(merchantDomain ? { merchantDomain } : {}),
    ...(trackingToken ? { trackingToken } : {}),
  } as const;
}
