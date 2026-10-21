'use client';
// Uses checkout state, client cart context, and interactive handlers.
import type { useCheckoutAttemptSession } from '../hooks/use-checkout-attempt-session';
import { CheckoutCartCapacityGate } from './CheckoutCartCapacityGate';
import { CheckoutScreen, type CheckoutScreenProps } from './CheckoutScreen';

export function matchesValidatedResume(
  order: { id: string } | null,
  requestedId: string | null
): boolean {
  return Boolean(order && requestedId && order.id === requestedId);
}
/** Resolve the order through the existing authorized resume lifecycle before bypassing capacity. */
export function CheckoutCartScreen({
  model,
  order,
  requestedId,
}: {
  model: CheckoutScreenProps;
  requestedId: string | null;
  order: ReturnType<typeof useCheckoutAttemptSession>['resumedOrder'];
}) {
  return (
    <CheckoutCartCapacityGate
      validatedResume={matchesValidatedResume(order, requestedId)}
      onReturnToCart={model.page.onReturnToCart}
    >
      <CheckoutScreen {...model} />
    </CheckoutCartCapacityGate>
  );
}
