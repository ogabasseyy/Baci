import { Alert } from 'react-native';
import {
  clearPersistedRedvaultOrder,
  type ResolvePersistedRedvaultOrderResult,
  readPersistedRedvaultOrder,
  resolvePersistedRedvaultOrder,
} from '@/lib/pending-redvault-order';
import { attachRedvaultGuestOrderAfterSignup } from './attach-redvault-guest-order';
import { cancelRedvaultOrder } from './cancel-redvault-order';
import {
  initializeRedvaultCheckoutById,
  RedvaultInitializationError,
} from './redvault/initialize-redvault-checkout';
import {
  type FencedRedvaultOrderState,
  fetchFencedRedvaultOrderState,
  routeToPaidFenceOrder,
} from './resolve-checkout-redvault-fence';

export type ResolveRedvaultResubmitDisposition = 'proceed' | 'handled';

/**
 * Resolves a persisted REDVAULT fence before another REDVAULT submit. After
 * an app restart the shopper may resubmit with a changed cart or checkout
 * generation, which derives a different suffixed idempotency key — creating
 * the order blindly would open a second inventory-reserving order while the
 * first attempt may still capture. Paid fences route to the completed
 * order; terminal fences clear and recreate; unresolved fences cancel-then-
 * recreate so edits are honored, replaying the live checkout when the
 * previous attempt can no longer be cancelled.
 */
export async function resolveRedvaultFenceForResubmit({
  attemptGuestAttach,
  clearCart,
  customerEmail,
  customerName,
  customerPhone,
  onInitializationSuccess,
}: {
  attemptGuestAttach: boolean;
  clearCart: () => void | Promise<void>;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  onInitializationSuccess: () => void | Promise<void>;
}): Promise<ResolveRedvaultResubmitDisposition> {
  const persisted = await readPersistedRedvaultOrder();
  if (!persisted) return 'proceed';
  let fenced: ResolvePersistedRedvaultOrderResult;
  let fencedState: FencedRedvaultOrderState;
  try {
    fencedState = await fetchFencedRedvaultOrderState(persisted);
    fenced = await resolvePersistedRedvaultOrder({
      validateOrder: async () => ({ order: fencedState }),
    });
  } catch {
    Alert.alert(
      'Unable to verify pending payment',
      'We could not check your pending UBA payment. Please try again.'
    );
    return 'handled';
  }
  if (!fenced.blocked && fenced.paidOrderId) {
    await routeToPaidFenceOrder({
      clearCart,
      orderId: fenced.paidOrderId,
      orderNumber: fencedState.order_number,
      trackingToken: persisted.trackingToken,
    });
    return 'handled';
  }
  if (!fenced.blocked) return 'proceed';
  const result = await cancelRedvaultOrder({
    orderId: persisted.orderId,
    reason: 'Customer resubmitted UBA checkout after app restart',
    trackingToken: persisted.trackingToken,
  });
  if (result === 'cancelled' || result === 'gone') {
    await clearPersistedRedvaultOrder();
    return 'proceed';
  }
  if (result === 'live') {
    Alert.alert(
      'UBA payment in progress',
      'Your UBA payment was already in progress, so we continued with your original order.'
    );
    try {
      const outcome = await initializeRedvaultCheckoutById({
        orderId: persisted.orderId,
        customerEmail,
        customerName,
        customerPhone,
        ...(fencedState.total != null
          ? { amount: String(fencedState.total) }
          : {}),
        trackingToken: persisted.trackingToken,
        onReady: async () => {
          await onInitializationSuccess();
          // A guest signup during replay changes the auth identity after
          // the fenced application was created: attach it like the fresh
          // path does, or the replayed checkout can never verify.
          if (attemptGuestAttach) {
            await attachRedvaultGuestOrderAfterSignup({
              orderId: persisted.orderId,
            });
          }
        },
      });
      if (outcome === 'pending') {
        Alert.alert(
          'Payment still processing',
          'Your UBA payment is still being verified. Do not pay again; check your orders shortly.'
        );
      }
    } catch (error) {
      if (
        error instanceof RedvaultInitializationError &&
        error.kind === 'definitive'
      ) {
        Alert.alert(
          'Unable to continue payment',
          'We could not reopen your UBA payment. Please try again.'
        );
      } else {
        Alert.alert(
          'Payment still processing',
          'Your UBA payment is still being verified. Do not pay again; check your orders shortly.'
        );
      }
    }
    return 'handled';
  }
  Alert.alert(
    'Unable to release previous order',
    'We could not release your previous UBA order. Please try again.'
  );
  return 'handled';
}
