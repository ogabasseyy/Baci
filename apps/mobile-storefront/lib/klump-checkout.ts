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

/** Retired globally; stale app state must not submit another Klump order. */
export function getKlumpDisabledReason(
  _settings: KlumpPaymentSettings | undefined | null,
  _orderTotal: number,
  _walletSelection?: WalletSelection,
  _savingsSelection?: SavingsSelection
): string {
  return 'Klump is no longer available. Choose another payment method.';
}

export function shouldHideKlumpPaymentMethod(
  _settings: KlumpPaymentSettings | undefined | null,
  _orderTotal: number
): boolean {
  return true;
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
