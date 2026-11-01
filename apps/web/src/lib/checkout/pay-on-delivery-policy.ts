export const PAY_ON_DELIVERY_DISABLED_BODY = {
  code: 'PAY_ON_DELIVERY_DISABLED',
  error: 'Pay on Delivery is not available for this store',
};

type PolicyClient = {
  rpc(
    name: string,
    args: Record<string, string>
  ): PromiseLike<{
    data: unknown;
    error: unknown;
  }>;
};
type PolicyResult =
  | { ok: true }
  | {
      ok: false;
      status: 403 | 503;
      body: { code: string; error: string };
    };

export function isPayOnDelivery(paymentMethod: string): boolean {
  return paymentMethod === 'pod' || paymentMethod === 'pay_on_delivery';
}

function unavailable(): PolicyResult {
  return {
    ok: false,
    status: 503,
    body: {
      code: 'POD_POLICY_UNAVAILABLE',
      error: 'Unable to verify Pay on Delivery availability',
    },
  };
}

/** Normal RLS client only; the database trigger rechecks admission atomically. */
export async function validatePayOnDeliveryPolicy(input: {
  client: PolicyClient;
  merchantId: string;
  paymentMethod: string;
  checkoutRequestHash: string | null;
  requestIdempotencyKey: string | null;
}): Promise<PolicyResult> {
  if (!isPayOnDelivery(input.paymentMethod)) return { ok: true };
  const { data, error } = await input.client.rpc(
    'get_storefront_payment_settings',
    {
      p_merchant_id: input.merchantId,
    }
  );
  if (error || !Array.isArray(data) || data.length > 1) return unavailable();
  const settings: unknown = data[0];
  if (
    typeof settings === 'object' &&
    settings !== null &&
    'pay_on_delivery_enabled' in settings &&
    settings.pay_on_delivery_enabled === true
  ) {
    return { ok: true };
  }
  // Preserve an accepted identical retry after the merchant disables POD.
  // A client-supplied key alone is never replay authorization: the hash must
  // be server-derived and confirmed against that merchant's persisted order.
  if (input.requestIdempotencyKey && input.checkoutRequestHash) {
    const replay = await input.client.rpc(
      'is_storefront_order_idempotency_hash',
      {
        p_merchant_id: input.merchantId,
        p_checkout_idempotency_key: input.requestIdempotencyKey,
        p_checkout_request_hash: input.checkoutRequestHash,
      }
    );
    if (replay.error) return unavailable();
    if (replay.data === true) return { ok: true };
  }
  return { ok: false, status: 403, body: PAY_ON_DELIVERY_DISABLED_BODY };
}
