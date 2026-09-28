import type { PendingCheckoutOrderSnapshot } from './pending-checkout-order';

interface CheckoutResumeSearchParams {
  get(name: string): string | null;
}

interface ResolveCheckoutResumeContextInput {
  searchParams: CheckoutResumeSearchParams;
  pendingCheckoutOrder: PendingCheckoutOrderSnapshot | null;
  merchantId?: string;
  merchantSlug?: string;
}

interface CheckoutResumeContext {
  resumeOrderId: string | null;
  resumeTrackingToken: string | null;
  resumeLookupEmail: string | null;
  resumeMerchantSlug: string | null;
  preferredGateway: 'credpal' | 'credit_direct' | null;
}

export function resolveCheckoutResumeContext({
  searchParams,
  pendingCheckoutOrder,
  merchantId,
  merchantSlug,
}: ResolveCheckoutResumeContextInput): CheckoutResumeContext {
  const orderId = searchParams.get('orderId');
  const gateway = searchParams.get('gateway')?.toLowerCase();
  const canUsePendingOrderEmail =
    pendingCheckoutOrder?.orderId === orderId &&
    pendingCheckoutOrder.customerEmail &&
    (!merchantId || pendingCheckoutOrder.merchantId === merchantId);

  return {
    resumeOrderId: orderId,
    resumeTrackingToken:
      searchParams.get('trackingToken') ||
      searchParams.get('tracking_token') ||
      searchParams.get('token'),
    resumeLookupEmail:
      searchParams.get('email')?.trim() ||
      (canUsePendingOrderEmail
        ? pendingCheckoutOrder.customerEmail.trim()
        : '') ||
      null,
    resumeMerchantSlug:
      searchParams.get('merchant_slug') ||
      searchParams.get('slug') ||
      merchantSlug ||
      null,
    preferredGateway:
      gateway === 'credpal'
        ? 'credpal'
        : gateway === 'credit_direct'
          ? 'credit_direct'
          : null,
  };
}
