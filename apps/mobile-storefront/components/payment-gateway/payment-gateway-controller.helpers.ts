import type { Href } from 'expo-router';
import type { WalletTopUpGateway } from '@/lib/wallet-top-up';
import { PaymentGatewayParamsSchema } from '@/schemas/payment-gateway';
import { PAYMENT_KINDS } from './payment-gateway.helpers';

export const PAYMENT_LOAD_TIMEOUT_MS = 45_000;
export const PAYMENT_SUCCESS_NAV_DELAY_MS = 1500;
export const PAYMENT_LOAD_TIMEOUT_MESSAGE =
  'Payment page is taking longer than expected. Check your connection and try again.';
export const WALLET_QUERY_KEY = ['wallet'] as const;

export function isWalletTopUpGateway(
  value: unknown
): value is WalletTopUpGateway {
  return value === 'paystack' || value === 'korapay';
}

export function getWalletReturnHref(returnTo?: string): Href {
  return (returnTo || '/wallet') as Href;
}

export function getCloseConfirmationMessage(paymentKind?: string) {
  switch (paymentKind) {
    case PAYMENT_KINDS.PRIMARY_WALLET_CARD:
      return 'Your card funding operation is saved. Leaving does not cancel a charge already in progress. Check its status from your wallet. Do not pay again.';
    case PAYMENT_KINDS.SAVINGS_AUTH:
      return 'If you leave now, your savings card authorization may remain incomplete.';
    case PAYMENT_KINDS.VTU:
      return 'If you leave now, this utility payment may remain incomplete until you retry it.';
    case PAYMENT_KINDS.WALLET:
      return 'If you leave now, your wallet top-up may remain incomplete until you retry it.';
    default:
      return 'Your order has been created. If you leave, you can complete payment later from your orders page.';
  }
}

export function parsePaymentGatewayParams(params: Record<string, string>) {
  const result = PaymentGatewayParamsSchema.safeParse(params);
  if (!result.success) {
    return {
      data: null,
      error: result.error.issues[0]?.message || 'Invalid parameters',
      isValid: false,
    };
  }
  return { data: result.data, error: null, isValid: true };
}
