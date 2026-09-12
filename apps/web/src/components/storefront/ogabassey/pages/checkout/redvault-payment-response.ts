import { fetchWithCsrf } from '@/lib/api-client';

export { parseRedvaultOrderQuote } from './parse-redvault-order-quote';

type RedvaultInitializationInput = {
  merchantId: string;
  orderId: string;
  currency: string;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  billingAddress: {
    line1: string;
    city: string;
    state?: string;
    country: string;
    zip_code?: string;
  };
};

type RedvaultInitializationResult =
  | { kind: 'authorization_url'; authorizationUrl: string }
  | { kind: 'pending_reconciliation' }
  | { kind: 'captured_held' };

export async function initializeRedvaultPayment(
  input: RedvaultInitializationInput,
  request = fetchWithCsrf
): Promise<RedvaultInitializationResult> {
  const response = await request('/api/payments/initialize', {
    method: 'POST',
    body: JSON.stringify({
      merchant_id: input.merchantId,
      order_id: input.orderId,
      currency: input.currency,
      customer_email: input.customerEmail,
      customer_name: input.customerName,
      customer_phone: input.customerPhone,
      gateway: 'paystack',
      payment_method: 'uba_redvault',
      billing_address: input.billingAddress,
    }),
  });
  const body: unknown = await response.json().catch(() => null);
  const code =
    body &&
    typeof body === 'object' &&
    typeof (body as { code?: unknown }).code === 'string'
      ? (body as { code: string }).code
      : null;

  if (response.status === 202 && code === 'REDVAULT_RECONCILIATION_REQUIRED') {
    return { kind: 'pending_reconciliation' };
  }
  if (response.status === 202 && code === 'REDVAULT_CAPTURE_HELD') {
    return { kind: 'captured_held' };
  }
  if (
    response.status === 202 ||
    !response.ok ||
    !body ||
    typeof body !== 'object' ||
    typeof (body as { authorization_url?: unknown }).authorization_url !==
      'string'
  ) {
    const message =
      body &&
      typeof body === 'object' &&
      typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : 'Unable to initialize Pay with UBA';
    throw new Error(message);
  }
  return {
    kind: 'authorization_url',
    authorizationUrl: (body as { authorization_url: string }).authorization_url,
  };
}
