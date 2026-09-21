import { captureBnplPaymentCompleted } from './capture-bnpl-payment-completed';

interface KlumpCallbackSettlement {
  orderId: string;
  klumpReference: string;
  trackingToken: string;
  merchantSlug: string;
}

interface KlumpSettlementOrderRow {
  payment_status?: string;
  total?: unknown;
  currency?: unknown;
}

/**
 * Deferred Klump conversion attribution for the redirect callback.
 * Extracted from bnpl-launcher.tsx (300-line file limit): the record call
 * stores the transaction id but proves no settlement, so the conversion
 * counts only when the order row is server-confirmed paid (the Klump
 * webhook finalizes async). Resolves quietly when verification is
 * unavailable — navigation proceeds regardless so the shopper is never
 * stranded by a pending webhook.
 */
export async function captureKlumpCallbackSettlementIfPaid({
  orderId,
  klumpReference,
  trackingToken,
  merchantSlug,
}: KlumpCallbackSettlement): Promise<void> {
  try {
    const orderQuery = new URLSearchParams({
      merchant_slug: merchantSlug,
    });
    orderQuery.set('token', trackingToken);
    const orderRes = await fetch(
      `/api/storefront/orders/${orderId}?${orderQuery.toString()}`
    );
    const orderData = (await orderRes.json()) as KlumpSettlementOrderRow | null;
    if (orderRes.ok && orderData?.payment_status === 'paid') {
      // Pass the verified row into the first capture: the once-guard
      // would otherwise suppress the richer order-success lookup,
      // leaving the conversion valueless.
      const klumpTotal = Number(orderData.total);
      const klumpCurrency =
        typeof orderData.currency === 'string' && orderData.currency.trim()
          ? orderData.currency.trim()
          : undefined;
      captureBnplPaymentCompleted({
        orderId,
        paymentMethod: 'klump',
        reference: klumpReference,
        ...(Number.isFinite(klumpTotal) ? { value: klumpTotal } : {}),
        ...(klumpCurrency ? { currency: klumpCurrency } : {}),
      });
    }
  } catch {
    // Verification unavailable: skip attribution rather than
    // record an unverified conversion.
  }
}
