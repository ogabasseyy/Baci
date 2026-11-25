import { z } from 'zod';
import { isOxygenStorefrontStagingEnabled } from '@/config/oxygen-storefront-staging';
import { createClient } from '@/lib/supabase/client';
import type {
  ChatwootCheckoutFailureCode,
  ChatwootCheckoutPlaceResult,
} from './chatwoot-checkout-result';

/**
 * Verifies that Oxygen Pay Small Small is enabled on staging and the
 * storefront session belongs to the customer email placing the order.
 */
export async function verifyChatwootOxygenCheckoutSession(
  customerEmail: string
): Promise<boolean> {
  if (!isOxygenStorefrontStagingEnabled()) return false;
  const {
    data: { user },
    error,
  } = await createClient().auth.getUser();
  return Boolean(
    !error &&
      user?.email &&
      user.email.trim().toLowerCase() === customerEmail.trim().toLowerCase()
  );
}

/**
 * Posts the first-party Oxygen secure-handoff result for a created or replayed
 * order, failing closed if the order ID is not a valid UUID.
 */
export function postChatwootOxygenHandoff(input: {
  orderId: string;
  requestId: string;
  canPost: () => boolean;
  postResult: (result: ChatwootCheckoutPlaceResult) => void;
  fail: (code: ChatwootCheckoutFailureCode) => void;
}): void {
  if (!z.uuid().safeParse(input.orderId).success) {
    input.fail('order_failed');
    return;
  }
  if (input.canPost()) {
    input.postResult({
      requestId: input.requestId,
      status: 'secure_handoff',
      href: `/payments/oxygen/${input.orderId}`,
    });
  }
}
