import { fetchWithCsrf } from '@/lib/api-client';
import type { CheckoutPaymentOrder } from './submit-checkout-order';

export type RedirectGateway = 'paystack' | 'korapay' | 'juicyway' | 'klump';

export interface InitializedCryptoPayment {
  address: string;
  chain: string;
  currency: string;
  amount: number;
  confirmation_time: string;
  payment_id?: string;
}

export interface InitializedCheckoutGatewayPayment {
  success: boolean;
  reference: string;
  authorization_url?: string;
  checkout_url?: string;
  session_id?: string;
  crypto_payment?: InitializedCryptoPayment;
}

export interface InitializeCheckoutGatewayOptions {
  merchantId: string;
  order: CheckoutPaymentOrder;
  currency: string;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  gateway: RedirectGateway;
  billingAddress: {
    line1: string;
    city: string;
    state?: string;
    country: string;
    zip_code?: string;
  };
  request?: typeof fetch;
}

/** Initializes redirect-backed payment rails after the authoritative order exists. */
export async function initializeCheckoutGateway({
  merchantId,
  order,
  currency,
  customerEmail,
  customerName,
  customerPhone,
  gateway,
  billingAddress,
  request,
}: InitializeCheckoutGatewayOptions): Promise<InitializedCheckoutGatewayPayment> {
  const isBankOffer = order.payment_method === 'bank_card_offer';
  const send = request ?? (isBankOffer ? fetchWithCsrf : fetch);
  const response = await send('/api/payments/initialize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      merchant_id: merchantId,
      order_id: order.id,
      currency,
      customer_email: customerEmail,
      customer_name: customerName,
      customer_phone: customerPhone,
      gateway: isBankOffer ? 'paystack' : gateway,
      ...(isBankOffer && { payment_method: 'bank_card_offer' }),
      billing_address: billingAddress,
    }),
  });

  if (isBankOffer && (response.status === 202 || response.status === 503)) {
    throw new Error(
      'Payment initialization is pending. Retry from the same order.'
    );
  }
  if (!response.ok) {
    const errorData: unknown = await response.json().catch(() => null);
    const message =
      errorData &&
      typeof errorData === 'object' &&
      typeof (errorData as { error?: unknown }).error === 'string'
        ? (errorData as { error: string }).error
        : 'Payment initialization failed';
    throw new Error(message);
  }

  const result: unknown = await response.json().catch(() => null);
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('Payment initialization failed');
  }
  return result as InitializedCheckoutGatewayPayment;
}
