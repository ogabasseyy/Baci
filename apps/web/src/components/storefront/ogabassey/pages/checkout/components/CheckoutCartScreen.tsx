'use client';
import { useSearchParams } from 'next/navigation';
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
}: {
  model: CheckoutScreenProps;
  order: ReturnType<typeof useCheckoutAttemptSession>['resumedOrder'];
}) {
  const requestedId = useSearchParams().get('orderId');
  return (
    <CheckoutCartCapacityGate
      validatedResume={matchesValidatedResume(order, requestedId)}
      onReturnToCart={model.page.onReturnToCart}
    >
      <CheckoutScreen {...model} />
    </CheckoutCartCapacityGate>
  );
}
