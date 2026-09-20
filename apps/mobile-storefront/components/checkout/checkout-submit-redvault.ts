import { Alert } from 'react-native';
import type { ShippingAddressInput } from '@/lib/validation';
import { attachRedvaultGuestOrderAfterSignup } from './attach-redvault-guest-order';
import { runCheckoutPostOrderSideEffects } from './checkout-post-order-side-effects';
import {
  resolveCheckoutRedvaultFence,
  routeToPaidFenceOrder,
} from './resolve-checkout-redvault-fence';
import { resolveRedvaultFenceForResubmit } from './resolve-redvault-resubmit-fence';

type SubmitCustomer =
  | {
      email?: string | null;
      id?: string;
    }
  | null
  | undefined;

export type CheckoutSubmitFenceResult = {
  proceed: boolean;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
};

/**
 * REDVAULT submit preamble: guards the unavailable review, derives the
 * customer identity the fence replay needs, and resolves the inventory
 * fence before any new order is created. Non-REDVAULT submits validate a
 * possibly-stale fenced order (app kill); REDVAULT submits resolve the
 * resubmit fence (changed cart/generation would derive a new idempotency
 * key and open a second reserving order). Returns proceed=false when the
 * submit must stop (alert shown, paid fence routed, or fence held).
 */
export async function resolveCheckoutSubmitFence({
  accountPassword,
  address,
  clearCart,
  customer,
  isAuthenticated,
  onRedvaultOrder,
  saveAsDefaultAddress,
  saveDetails,
  selectedPayment,
  selectedSavedAddressId,
}: {
  accountPassword: string;
  address: ShippingAddressInput;
  clearCart: () => void | Promise<void>;
  customer: SubmitCustomer;
  isAuthenticated: boolean;
  // Presence-tested only: the review callback lives with the submit hook.
  onRedvaultOrder?: unknown;
  saveAsDefaultAddress: boolean;
  saveDetails: boolean;
  selectedPayment: string | null;
  selectedSavedAddressId: string | null;
}): Promise<CheckoutSubmitFenceResult> {
  const customerEmail = customer?.email || address.email;
  const customerPhone = address.phone;
  const customerName = `${address.firstName} ${address.lastName}`;
  const stop = {
    proceed: false,
    customerEmail,
    customerName,
    customerPhone,
  };
  if (selectedPayment === 'uba_redvault' && !onRedvaultOrder) {
    Alert.alert(
      'Unable to continue',
      'UBA payment review is unavailable. Please choose another payment method.'
    );
    return stop;
  }
  if (selectedPayment !== 'uba_redvault') {
    // After an app kill the in-memory review is gone while the order
    // still fences inventory (and may capture): validate first.
    const fence = await resolveCheckoutRedvaultFence();
    if (!fence.proceed) {
      return stop;
    }
    if (fence.paidOrderId) {
      await routeToPaidFenceOrder({
        clearCart,
        orderId: fence.paidOrderId,
        orderNumber: fence.paidOrderNumber,
        trackingToken: fence.paidTrackingToken,
      });
      return stop;
    }
  } else {
    // REDVAULT submits must resolve the fence too: a restarted app may
    // resubmit with a changed cart or checkout generation, which derives
    // a different suffixed idempotency key and would otherwise open a
    // second inventory-reserving order while the first may still capture.
    const disposition = await resolveRedvaultFenceForResubmit({
      attemptGuestAttach:
        !isAuthenticated && saveDetails && accountPassword.length >= 6,
      clearCart,
      customerEmail,
      customerName,
      customerPhone,
      onInitializationSuccess: async () => {
        // Awaited: the resubmit flow attaches the guest order after this
        // resolves, so the signup must be complete first.
        await runCheckoutPostOrderSideEffects({
          accountPassword,
          address,
          customerEmail,
          customerId: customer?.id,
          isAuthenticated,
          saveAsDefaultAddress,
          saveDetails,
          selectedSavedAddressId,
        });
      },
    });
    if (disposition !== 'proceed') {
      return stop;
    }
  }
  return { proceed: true, customerEmail, customerName, customerPhone };
}

/**
 * REDVAULT post-initialization side effects for a fresh submit: runs the
 * shared post-order effects (signup, address), then attaches the guest
 * order when a guest signup just changed the auth identity after the
 * application was created with a null user_id.
 */
export async function runRedvaultSubmitInitializationSideEffects({
  accountPassword,
  address,
  customerEmail,
  customerId,
  isAuthenticated,
  orderId,
  saveAsDefaultAddress,
  saveDetails,
  selectedSavedAddressId,
}: {
  accountPassword: string;
  address: ShippingAddressInput;
  customerEmail: string;
  customerId: string | undefined;
  isAuthenticated: boolean;
  orderId: string;
  saveAsDefaultAddress: boolean;
  saveDetails: boolean;
  selectedSavedAddressId: string | null;
}): Promise<void> {
  await runCheckoutPostOrderSideEffects({
    accountPassword,
    address,
    customerEmail,
    customerId,
    isAuthenticated,
    saveAsDefaultAddress,
    saveDetails,
    selectedSavedAddressId,
  });
  // A guest signup above changed the auth identity after the
  // application was created with a null user_id: attach it so an
  // interrupted checkout can still replay or verify under the new
  // session.
  if (!isAuthenticated && saveDetails && accountPassword.length >= 6) {
    await attachRedvaultGuestOrderAfterSignup({ orderId: orderId });
  }
}
