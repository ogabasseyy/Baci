import {
  type ResolvePendingCheckoutOrderOptions,
  type ResolvePendingCheckoutOrderResult,
  resolvePendingCheckoutOrder,
} from '../pending-checkout-order';
import {
  type ResolveRedvaultSubmitFenceOptions,
  resolveRedvaultSubmitFence,
} from './redvault-submit-fence';

export interface RecoverPendingCheckoutOrderOptions {
  reuse: ResolvePendingCheckoutOrderOptions;
  context: Omit<
    ResolveRedvaultSubmitFenceOptions,
    'fence' | 'checkoutFingerprint' | 'customerEmail' | 'merchantId'
  >;
}

export type RecoverPendingCheckoutOrderResult =
  | { kind: 'handled' }
  | {
      kind: 'submit';
      pendingOrder: Pick<ResolvePendingCheckoutOrderResult, 'reusableOrder'> & {
        clearStoredOrder: false;
      };
    };

/**
 * Resolve the stored order and finish its payment fence before permitting
 * submission. Lookup, cancellation, and replay failures propagate without
 * exposing a submission result. Paid or live replay paths finish checkout here.
 */
export async function recoverPendingCheckoutOrder({
  reuse,
  context,
}: RecoverPendingCheckoutOrderOptions): Promise<RecoverPendingCheckoutOrderResult> {
  const resolution = await resolvePendingCheckoutOrder(reuse);
  const handled = await resolveRedvaultSubmitFence({
    ...context,
    fence: resolution,
    checkoutFingerprint: reuse.checkoutFingerprint,
    customerEmail: reuse.customerEmail,
    merchantId: reuse.merchantId,
  });
  if (handled) return { kind: 'handled' };

  // Only a completed fence may become a submission-safe result. Any snapshot
  // clearing has already happened, so submission must not repeat it.
  return {
    kind: 'submit',
    pendingOrder: {
      reusableOrder: resolution.reusableOrder,
      clearStoredOrder: false,
    },
  };
}
