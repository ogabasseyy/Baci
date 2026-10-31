import {
  AGENTIC_PAYMENT_METHOD_GOOGLE_PAY,
  AGENTIC_PAYMENT_METHOD_PAY_ON_DELIVERY,
  AGENTIC_PAYMENT_METHOD_PAYSTACK_BANK_TRANSFER,
  type AgenticPaymentMethod,
} from '@/config/agentic-payment-methods';
import { getGooglePayAgenticConfig, getPaystackSecretKey } from '@/env';
import { isAgenticPaystackDvaPaused } from '@/lib/agentic/agentic-paystack-dva-paused';
import { isValidPaystackSubaccountCode } from '@/lib/agentic/paystack';
import type { CachedMerchant } from '@/lib/cached-data';

export type AgenticPaymentReadinessReason =
  | 'google_pay_not_configured'
  | 'google_pay_token_charging_unsupported'
  | 'pay_on_delivery_disabled'
  | 'paystack_dva_paused'
  | 'paystack_secret_missing'
  | 'paystack_subaccount_missing';

export type AgenticPaymentMethodDecision = {
  method: AgenticPaymentMethod;
  ready: boolean;
  reasons: AgenticPaymentReadinessReason[];
};

type PaymentMerchant = Pick<
  CachedMerchant,
  | 'feature_settings'
  | 'paystack_subaccount_code'
  | 'paystack_subaccount_configured'
>;

function decision(
  method: AgenticPaymentMethod,
  reasons: AgenticPaymentReadinessReason[]
): AgenticPaymentMethodDecision {
  return { method, ready: reasons.length === 0, reasons };
}

/**
 * Decides, per payment method, whether an agent may be told it can pay that
 * way, listing every unmet condition independently. The order is the order
 * the manifest advertises them in.
 *
 * Google Pay is never ready: UCP completion normalizes a Google Pay
 * instrument to Paystack and creates a dedicated virtual account instead of
 * charging the token (roadmap Task 13). A hosted-website Google Pay setting
 * is not the ability to charge a UCP token.
 */
export function decideAgenticPaymentMethods(
  merchant: PaymentMerchant
): AgenticPaymentMethodDecision[] {
  const paystackReasons: AgenticPaymentReadinessReason[] = [];
  if (!getPaystackSecretKey()) paystackReasons.push('paystack_secret_missing');
  // The public storefront snapshot omits the raw paystack_subaccount_code and
  // exposes the derived paystack_subaccount_configured hint instead, so the
  // public capability check accepts either signal (mirroring
  // isPaystackCheckoutAvailable). Private payment paths stay authoritative
  // over the raw code when a session is actually charged.
  if (
    !isValidPaystackSubaccountCode(merchant.paystack_subaccount_code) &&
    merchant.paystack_subaccount_configured !== true
  ) {
    paystackReasons.push('paystack_subaccount_missing');
  }
  if (isAgenticPaystackDvaPaused()) paystackReasons.push('paystack_dva_paused');

  const googlePayReasons: AgenticPaymentReadinessReason[] = [
    'google_pay_token_charging_unsupported',
    ...paystackReasons,
  ];
  if (getGooglePayAgenticConfig()?.gateway !== 'paystack') {
    googlePayReasons.push('google_pay_not_configured');
  }

  return [
    decision(AGENTIC_PAYMENT_METHOD_PAYSTACK_BANK_TRANSFER, paystackReasons),
    decision(AGENTIC_PAYMENT_METHOD_GOOGLE_PAY, googlePayReasons),
    decision(
      AGENTIC_PAYMENT_METHOD_PAY_ON_DELIVERY,
      merchant.feature_settings?.pay_on_delivery_enabled === true
        ? []
        : ['pay_on_delivery_disabled']
    ),
  ];
}
