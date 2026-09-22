import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/hooks/use-toast';
import type { CartItem } from '@/hooks/cart';
import { buildCheckoutOrderItems } from '@/lib/checkout/build-order-items';
import { asRoute } from '@/lib/routes';
import { captureCheckoutPaymentCompleted } from '../capture-checkout-payment-completed';
import { clearCheckoutIdempotencyKey } from '../checkout-idempotency';

/**
 * Provisioned DVA shown in the transfer modal: reference + order binding
 * plus the stamped totals the completion reports.
 */
export interface DvaModalData {
  account_number: string;
  account_name: string;
  bank_name: string;
  bank_code: string;
  amount: number;
  /** Full order total: `amount` is only the residual due at the DVA
   * after wallet credits, but purchase revenue is the whole order.
   */
  total: number;
  reference: string;
  orderId?: string;
  orderNumber?: string;
  trackingToken?: string | null;
  /** Originating checkout fingerprint: scopes post-confirm idempotency
   * cleanup so another tab's newer checkout keeps its recovery key. */
  checkoutFingerprint?: string;
  /** Normalized stamped order currency for completion labeling. */
  orderCurrency?: string;
}

async function verifyDvaTransferStatus({
  merchantSlug,
  reference,
  trackingToken,
}: {
  merchantSlug?: string;
  reference: string;
  trackingToken?: string | null;
}): Promise<boolean> {
  if (trackingToken && merchantSlug) {
    const response = await fetch(
      `/api/storefront/orders/track-order?token=${encodeURIComponent(trackingToken)}&merchant_slug=${encodeURIComponent(merchantSlug)}`
    );
    if (!response.ok) {
      return false;
    }
    const result = await response.json().catch(() => null);
    return result?.order?.payment_status === 'paid';
  }
  const response = await fetch(
    `/api/payments/status?gateway=paystack&reference=${encodeURIComponent(reference)}`
  );
  if (!response.ok) {
    return false;
  }
  const result = await response.json().catch(() => null);
  return result?.success === true && result?.is_confirmed === true;
}

export interface DvaConfirmTransferDeps {
  checkoutCart: CartItem[];
  clearCart: () => void;
  clearCheckoutSession: () => void;
  clearPendingCheckoutOrder: () => void;
  currencyCode: string;
  dvaData: DvaModalData | null;
  getHref: (path: string) => string;
  merchantSlug?: string;
  setDvaData: (data: DvaModalData | null) => void;
}

/**
 * Owns the "Confirm Transfer Sent" lifecycle for the provisioned-DVA
 * modal: server-side verification, paid conversion, routing, and the
 * delayed cart clear — all tied to the modal attempt that started them.
 *
 * Closing the modal retires the attempt synchronously (a ref, visible
 * even before React re-renders), and the continuation rechecks after
 * every await: a late confirmation never clears state, routes, or
 * clears the cart — the delayed clear could otherwise erase a newer
 * cart.
 */
export function useDvaConfirmTransfer({
  checkoutCart,
  clearCart,
  clearCheckoutSession,
  clearPendingCheckoutOrder,
  currencyCode,
  dvaData,
  getHref,
  merchantSlug,
  setDvaData,
}: DvaConfirmTransferDeps) {
  const [isVerifyingDva, setIsVerifyingDva] = useState(false);
  const dvaConfirmAttemptRef = useRef(0);
  const router = useRouter();

  const closeDvaModal = () => {
    dvaConfirmAttemptRef.current += 1;
    setDvaData(null);
  };

  // "Confirm Transfer Sent" verifies the DVA reference server-side before
  // recording the conversion: the modal may show a stale pending order
  // while the shopper already paid in their bank app. A late
  // 'legacy-order' DVA entry stays retryable on transport or gateway
  // failure, and stay on the modal so the shopper can retry or
  // close-and-check-later.
  const handleDvaConfirmTransfer = () => {
    if (!dvaData || !dvaData.orderId || isVerifyingDva) {
      return;
    }
    const {
      orderId,
      orderNumber,
      reference,
      amount,
      total: dvaTotal,
      trackingToken,
      checkoutFingerprint: dvaCheckoutFingerprint,
      orderCurrency: dvaOrderCurrency,
    } = dvaData;
    const confirmAttempt = dvaConfirmAttemptRef.current;
    setIsVerifyingDva(true);
    verifyDvaTransferStatus({
      merchantSlug,
      reference,
      trackingToken,
    })
      .then(async (confirmed) => {
        if (!confirmed) {
          toast({
            title: 'Transfer not detected yet',
            description:
              'We could not find your transfer. If you already sent it, wait a moment and confirm again.',
          });
          return;
        }
        // The modal closed while the status request was pending (either
        // close action retires the attempt): the shopper chose "close and
        // check later", so never clear state, route, or clear the cart —
        // the delayed cart clear could otherwise erase a newer cart.
        if (confirmAttempt !== dvaConfirmAttemptRef.current) {
          return;
        }
        const confirmedItems = buildCheckoutOrderItems(checkoutCart);
        // Stamped currency retained from initialization: matches the
        // start even if the merchant changed payout currency since.
        captureCheckoutPaymentCompleted({
          currency: dvaOrderCurrency ?? currencyCode,
          itemCount: confirmedItems.reduce(
            (count, item) => count + item.quantity,
            0
          ),
          orderId,
          orderNumber,
          paymentMethod: 'bank_transfer',
          reference,
          total: dvaTotal ?? amount,
        });
        clearPendingCheckoutOrder();
        await clearCheckoutIdempotencyKey(dvaCheckoutFingerprint);
        // The idempotency cleanup awaits digest/storage work: recheck the
        // attempt, since the modal may have closed during that gap. The
        // conversion above already recorded, so this only gates the
        // routing and cart side effects below.
        if (confirmAttempt !== dvaConfirmAttemptRef.current) {
          return;
        }
        clearCheckoutSession();
        setDvaData(null);
        const successQuery = new URLSearchParams({
          type: 'standard',
          orderId,
        });
        if (trackingToken) {
          successQuery.set('trackingToken', trackingToken);
        }
        router.push(asRoute(getHref(`/order-success?${successQuery.toString()}`)));
        setTimeout(clearCart, 500);
      })
      .catch(() => {
        toast({
          title: 'Could not verify transfer',
          description: 'Please check your connection and try again.',
          variant: 'destructive',
        });
      })
      .finally(() => {
        setIsVerifyingDva(false);
      });
  };

  return { closeDvaModal, handleDvaConfirmTransfer, isVerifyingDva };
}
