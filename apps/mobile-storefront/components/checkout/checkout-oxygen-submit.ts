import { router } from 'expo-router';
import { type CreateOrderRequest, createOrder } from '@/services/orders';

type Input = {
  request: CreateOrderRequest;
  checkoutGeneration: string;
  isAuthenticated: boolean;
  hasVoucher: boolean;
  hasCredits: boolean;
  onOrderCreated?: (orderId: string) => void;
};
type Dependencies = {
  admit: () => Promise<unknown>;
  createOrder: typeof createOrder;
  navigate: (orderId: string) => void;
};
export async function submitOxygenCheckout(
  input: Input,
  dependencies?: Dependencies
) {
  if (
    !input.isAuthenticated ||
    input.hasVoucher ||
    input.hasCredits ||
    input.request.payment_method !== 'oxygen' ||
    input.request.use_wallet_credit ||
    input.request.use_savings_credit ||
    (input.request.wallet_amount ?? 0) > 0 ||
    (input.request.savings_amount ?? 0) > 0 ||
    input.request.items.some(
      (item) => item.voucher_token || item.voucher_award_id
    )
  ) {
    throw new Error(
      'Oxygen requires a signed-in customer and a cart without vouchers or store credit'
    );
  }
  const deps = dependencies ?? {
    admit: async () => {
      const { oxygenNativeSession } = await import(
        '@/services/oxygen/native-session'
      );
      return oxygenNativeSession().capabilities(true);
    },
    createOrder,
    navigate: (orderId: string) =>
      router.push({ pathname: '/oxygen-checkout', params: { orderId } }),
  };
  // Revalidate after every checkout await and immediately before order mutation.
  await deps.admit();
  const result = await deps.createOrder(input.request, {
    checkoutGeneration: input.checkoutGeneration,
    analyticsPaymentMethod: 'oxygen',
  });
  input.onOrderCreated?.(result.order.id);
  deps.navigate(result.order.id);
  return result;
}
