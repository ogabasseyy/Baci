import {
  buildCheckoutFunnelProperties,
  CHECKOUT_FUNNEL_EVENTS,
  getCheckoutPaymentIntent,
} from '@baci/shared/contracts';
import { toast } from '@/hooks/use-toast';
import { openCreditDirectCheckout } from '@/lib/credit-direct-client';
import { getCredPalKey, openCredPalCheckout } from '@/lib/credpal';
import { captureCheckoutFunnelEventOnce } from '@/lib/posthog/capture-checkout-funnel-event';
import { captureCreditDirectClientCompletion } from '../credit-direct-client-completion';
import {
  type CreditDirectPopupMarker,
  writeCreditDirectPopupMarker,
} from '../credit-direct-popup-return';
import { persistCreditDirectPopupReference } from '../persist-credit-direct-popup-reference';
import type { ResumedOrder } from '../types';

export interface CreditDirectVerificationHandoff {
  orderId: string;
  merchantSlug: string;
  completionMarker?: CreditDirectPopupMarker | null;
  trackingToken?: string | null;
  customerEmail?: string | null;
}

export function buildCreditDirectVerificationPath({
  orderId,
  merchantSlug,
  completionMarker,
  trackingToken,
  customerEmail,
}: CreditDirectVerificationHandoff): string {
  const query = new URLSearchParams({
    orderId,
    gateway: 'credit_direct',
    merchant_slug: merchantSlug,
  });
  if (completionMarker) {
    query.set('creditDirectCompletion', completionMarker.transactionId);
  }
  if (trackingToken) query.set('trackingToken', trackingToken);
  if (customerEmail) query.set('email', customerEmail);
  return `/checkout/bnpl?${query.toString()}`;
}

export interface ExecuteResumedDirectPaymentOptions {
  resumedOrder: ResumedOrder | null;
  preferredGateway: 'credpal' | 'credit_direct' | null;
  merchantSlug?: string | null;
  /** Merchant's current payout currency; the stamped order currency wins. */
  merchantChargeCurrency: string;
  resumeTrackingToken?: string | null;
  resumeMerchantSlug?: string | null;
  setIsProcessing: (v: boolean) => void;
  clearCheckoutSession: () => void;
  routerPush: (url: string) => void;
  getHref: (path: string) => string;
}

/**
 * Execute direct payment for resumed orders (CredPal / Credit Direct).
 * Extracted from the checkout page (Boy Scout Rule): provider widgets are
 * statically imported — dynamic `import()` expressions bail React Compiler.
 */
export async function executeResumedDirectPayment({
  resumedOrder,
  preferredGateway,
  merchantSlug,
  merchantChargeCurrency,
  resumeTrackingToken,
  resumeMerchantSlug,
  setIsProcessing,
  clearCheckoutSession,
  routerPush,
  getHref,
}: ExecuteResumedDirectPaymentOptions): Promise<void> {
  if (!resumedOrder || !preferredGateway) return;

  setIsProcessing(true);
  try {
    const paymentAmount = resumedOrder.total;
    // The resumed order keeps the currency it was priced in: label its
    // funnel events with the stamped order currency, not the merchant's
    // current payout currency.
    const resumedCurrency = resumedOrder.currency ?? merchantChargeCurrency;

    // Resumed orders bypass the standard submission instrumentation, so
    // emit the funnel start here once the provider flow opens. Neither
    // opener proves that by resolving — CredPal resolves right after
    // `checkout.open()`, before the SDK fires `onLoad`, and Credit
    // Direct swallows init failures into `onError` — so each start fires
    // from its own opened signal (`onLoad` / `onPopup`). Errors before
    // that signal keep the toast + retry without a funnel event; once
    // opened, an error closes the attempt. Once semantics keep the
    // auto-trigger plus a manual retry to a single start per order.
    let resumedBnplOpened = false;
    const captureResumedPaymentStarted = (
      gateway: 'credpal' | 'credit_direct'
    ) => {
      resumedBnplOpened = true;
      captureCheckoutFunnelEventOnce(
        CHECKOUT_FUNNEL_EVENTS.paymentStarted,
        resumedOrder.id,
        buildCheckoutFunnelProperties({
          channel: 'web',
          currency: resumedCurrency,
          orderId: resumedOrder.id,
          paymentIntent: getCheckoutPaymentIntent(gateway),
          paymentMethod: gateway,
          source: 'web_checkout',
          total: paymentAmount,
        })
      );
    };
    const captureResumedPaymentFailed = (
      gateway: 'credpal' | 'credit_direct',
      reason: string
    ) => {
      if (!resumedBnplOpened) {
        return;
      }
      captureCheckoutFunnelEventOnce(
        CHECKOUT_FUNNEL_EVENTS.paymentFailed,
        resumedOrder.id,
        buildCheckoutFunnelProperties({
          channel: 'web',
          currency: resumedCurrency,
          orderId: resumedOrder.id,
          paymentIntent: getCheckoutPaymentIntent(gateway),
          paymentMethod: gateway,
          reason,
          source: 'web_checkout',
          total: paymentAmount,
        })
      );
    };

    // For CredPal, use the inline checkout widget (statically imported —
    // dynamic `import()` expressions bail React Compiler)
    if (preferredGateway === 'credpal') {
      const productNames =
        resumedOrder.items.map((item) => item.product_name).join(', ') ||
        'Purchase';

      await openCredPalCheckout({
        key: getCredPalKey(),
        amount: paymentAmount,
        product: productNames,
        customerEmail: resumedOrder.customer_email,
        customerName: resumedOrder.customer_name,
        customerPhone: resumedOrder.customer_phone,
        onSuccess: async (data) => {
          // Update order with payment reference
          await fetch(`/api/orders/update-payment-ref`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderId: resumedOrder.id,
              paymentRef: data.order_no,
              gateway: 'credpal',
            }),
          });
          // Resumed orders bypass the standard submission instrumentation,
          // so record the conversion here to avoid an artificial drop-off.
          // Accepted-but-pending applications are not paid conversions.
          if (data.status === 'success') {
            captureCheckoutFunnelEventOnce(
              CHECKOUT_FUNNEL_EVENTS.paymentCompleted,
              resumedOrder.id,
              buildCheckoutFunnelProperties({
                channel: 'web',
                currency: resumedCurrency,
                orderId: resumedOrder.id,
                paymentIntent: getCheckoutPaymentIntent('credpal'),
                paymentMethod: 'credpal',
                paymentStatus: 'paid',
                reference: data.order_no,
                source: 'web_checkout',
                total: resumedOrder.total,
              })
            );
          }
          clearCheckoutSession();
          const successQuery = new URLSearchParams({
            orderId: resumedOrder.id,
            type: 'credpal',
          });
          if (resumedOrder.tracking_token) {
            successQuery.set('trackingToken', resumedOrder.tracking_token);
          }
          routerPush(getHref(`/order-success?${successQuery.toString()}`));
        },
        onLoad: () => {
          // The opener resolves before the SDK loads: only a real load
          // proves the provider flow started (same gate as fresh flow).
          captureResumedPaymentStarted('credpal');
        },
        onError: (error) => {
          captureResumedPaymentFailed('credpal', 'credpal_error');
          toast({
            title: 'Payment Failed',
            description: error.message || 'CredPal payment failed',
            variant: 'destructive',
          });
          setIsProcessing(false);
        },
        onClose: () => {
          setIsProcessing(false);
        },
      });
      return;
    }

    // For Credit Direct, use their checkout widget (statically imported —
    // dynamic `import()` expressions bail React Compiler)
    if (preferredGateway === 'credit_direct') {
      await openCreditDirectCheckout({
        merchantSlug: merchantSlug || 'ogabassey',
        orderId: resumedOrder.id,
        trackingToken: resumedOrder.tracking_token ?? '',
        amount: paymentAmount,
        customerEmail: resumedOrder.customer_email,
        customerPhone: resumedOrder.customer_phone,
        customerName: resumedOrder.customer_name,
        items: resumedOrder.items.map((item) => ({
          id: item.product_id,
          name: item.product_name,
          price: item.price,
          quantity: item.quantity,
        })),
        onSuccess: ({ checkoutTransactionId, sessionId }) => {
          const trackingToken =
            resumedOrder.tracking_token || resumeTrackingToken;
          const resolvedMerchantSlug =
            merchantSlug || resumeMerchantSlug || 'ogabassey';
          const completionMarker = captureCreditDirectClientCompletion({
            orderId: resumedOrder.id,
            checkoutTransactionId,
            customerEmail: resumedOrder.customer_email,
            sessionId,
            trackingToken,
          });
          routerPush(
            getHref(
              buildCreditDirectVerificationPath({
                orderId: resumedOrder.id,
                merchantSlug: resolvedMerchantSlug,
                completionMarker,
                trackingToken,
                customerEmail: resumedOrder.customer_email,
              })
            )
          );
        },
        onError: (error) => {
          captureResumedPaymentFailed('credit_direct', 'credit_direct_error');
          toast({
            title: 'Payment Failed',
            description: error || 'Credit Direct payment failed',
            variant: 'destructive',
          });
          setIsProcessing(false);
        },
        onClose: () => {
          setIsProcessing(false);
        },
        onPopup: async ({ checkoutTransactionId, sessionId }) => {
          // The opener swallows initialization failures into onError
          // instead of rejecting, so only a real popup opening proves the
          // provider flow started.
          captureResumedPaymentStarted('credit_direct');
          writeCreditDirectPopupMarker(
            resumedOrder.id,
            checkoutTransactionId || sessionId
          );
          if (!checkoutTransactionId) {
            return;
          }
          try {
            await persistCreditDirectPopupReference(
              resumedOrder,
              checkoutTransactionId
            );
          } catch (error) {
            console.error(
              'Failed to persist Credit Direct popup reference:',
              error instanceof Error ? error.message : error
            );
          }
        },
      });
      return;
    }
  } catch (error) {
    console.error('Payment execution error:', error);
    setIsProcessing(false);
  }
}
