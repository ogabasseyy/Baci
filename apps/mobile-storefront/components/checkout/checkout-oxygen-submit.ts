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
  for (const [voucherField, value] of Object.entries({
    voucher_token,
    voucher_award_id,
    voucherToken,
    voucherAwardId,
  })) {
    if (value === undefined || value === null) continue;
    // The field name helps diagnose malformed carts without logging the code.
    const options = { cause: voucherField };
    if (typeof value !== 'string')
      throw new Error('Invalid voucher identifier', options);
    if (value.trim())
      throw new Error(
        'Oxygen requires a cart without vouchers or store credit',
        options
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
  const result = await deps.createOrder(
    {
      ...input.request,
      items,
    },
    {
      checkoutGeneration: input.checkoutGeneration,
      analyticsPaymentMethod: 'oxygen',
      expectedMerchantId: merchantId,
      expectedOwner: userId,
    }
  );
  if (result.order.total <= 0)
    throw new Error(
      'Choose another payment option for this zero-balance order.'
    );
  return result;
}
