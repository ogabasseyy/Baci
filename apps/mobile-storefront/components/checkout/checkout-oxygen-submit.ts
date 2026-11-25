import { z } from 'zod';
import { type CreateOrderRequest, createOrder } from '@/services/orders';

type Input = {
  request: CreateOrderRequest;
  checkoutGeneration: string;
  isAuthenticated: boolean;
  hasVoucher: boolean;
  hasCredits: boolean;
};
type Dependencies = {
  readOwner: () => Promise<{ merchantId: string; userId: string }>;
  createOrder: typeof createOrder;
};

export async function submitOxygenCheckout(
  input: Input,
  dependencies?: Dependencies
) {
  // This client check provides early feedback. POST /api/orders enforces admission.
  if (!input.isAuthenticated || input.request.payment_method !== 'oxygen') {
    throw new Error('Oxygen requires a signed-in customer');
  }
  const deps = dependencies ?? {
    readOwner: async () => {
      const { oxygenNativeSession } = await import(
        '@/services/oxygen/native-session'
      );
      const session = oxygenNativeSession();
      return { merchantId: session.profile.merchantId, userId: session.userId };
    },
    createOrder,
  };
  // Scope the send to the current owner. The API admits new orders and can
  // still return an exact previously accepted order during a rollout pause.
  const { merchantId, userId } = await deps.readOwner();
  const result = await deps.createOrder(input.request, {
    checkoutGeneration: input.checkoutGeneration,
    analyticsPaymentMethod: 'oxygen',
    expectedMerchantId: merchantId,
    expectedOwner: userId,
  });
  // A receipt must be usable by the owned-order screen before we hand off
  // and clear the cart. The generic order decoder accepts string order IDs.
  const { order } = result;
  if (
    !z.uuid().safeParse(order.id).success ||
    !Number.isFinite(order.total) ||
    order.payment_method !== 'oxygen' ||
    order.currency !== 'NGN'
  )
    throw new Error(
      'Could not confirm the saved Oxygen order. Please try again.'
    );
  if (
    (input.hasVoucher || input.hasCredits) &&
    result.amountDueToGateway === undefined
  ) {
    throw new Error(
      'Could not confirm the saved Oxygen order. Please try again.'
    );
  }
  if (order.total <= 0 || (result.amountDueToGateway ?? order.total) <= 0)
    throw new Error(
      'Choose another payment option for this zero-balance order.'
    );
  return result;
}
