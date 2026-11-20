import { type CreateOrderRequest, createOrder } from '@/services/orders';

type Input = {
  request: CreateOrderRequest;
  checkoutGeneration: string;
  isAuthenticated: boolean;
  hasVoucher: boolean;
  hasCredits: boolean;
};
type Dependencies = {
  admit: () => Promise<{ merchant: { id: string }; userId: string }>;
  createOrder: typeof createOrder;
};

type OxygenOrderItem = CreateOrderRequest['items'][number] & {
  voucherToken?: unknown;
  voucherAwardId?: unknown;
};

function prepareOxygenOrderItem({
  voucher_token,
  voucher_award_id,
  voucherToken,
  voucherAwardId,
  ...item
}: OxygenOrderItem) {
  for (const value of [
    voucher_token,
    voucher_award_id,
    voucherToken,
    voucherAwardId,
  ]) {
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string')
      throw new Error('Invalid voucher identifier');
    if (value.trim())
      throw new Error(
        'Oxygen requires a cart without vouchers or store credit'
      );
  }
  return item;
}

export async function submitOxygenCheckout(
  input: Input,
  dependencies?: Dependencies
) {
  // This client check provides early feedback. POST /api/orders enforces admission.
  if (
    !input.isAuthenticated ||
    input.hasVoucher ||
    input.hasCredits ||
    input.request.payment_method !== 'oxygen' ||
    input.request.use_wallet_credit ||
    input.request.use_savings_credit ||
    (input.request.wallet_amount ?? 0) > 0 ||
    (input.request.savings_amount ?? 0) > 0
  ) {
    throw new Error(
      'Oxygen requires a signed-in customer and a cart without vouchers or store credit'
    );
  }
  const items = input.request.items.map(prepareOxygenOrderItem);
  const deps = dependencies ?? {
    admit: async () => {
      const { oxygenNativeSession } = await import(
        '@/services/oxygen/native-session'
      );
      const session = oxygenNativeSession();
      const { merchant } = await session.capabilities(true);
      return { merchant, userId: session.userId };
    },
    createOrder,
  };
  // Revalidate after every checkout await and immediately before order mutation.
  const { merchant, userId } = await deps.admit();
  return deps.createOrder(
    {
      ...input.request,
      items,
    },
    {
      checkoutGeneration: input.checkoutGeneration,
      analyticsPaymentMethod: 'oxygen',
      expectedMerchantId: merchant.id,
      expectedOwner: userId,
    }
  );
}
