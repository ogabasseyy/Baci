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

function hasVoucherIdentifier(item: OxygenOrderItem): boolean {
  return [
    item.voucher_token,
    item.voucher_award_id,
    item.voucherToken,
    item.voucherAwardId,
  ].some(
    (value) =>
      value !== undefined &&
      value !== null &&
      (typeof value !== 'string' || value.trim().length > 0)
  );
}

function omitEmptyVoucherFields({
  voucher_token: _token,
  voucher_award_id: _awardId,
  voucherToken: _legacyToken,
  voucherAwardId: _legacyAwardId,
  ...item
}: OxygenOrderItem) {
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
    (input.request.savings_amount ?? 0) > 0 ||
    input.request.items.some(hasVoucherIdentifier)
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
      items: input.request.items.map(omitEmptyVoucherFields),
    },
    {
      checkoutGeneration: input.checkoutGeneration,
      analyticsPaymentMethod: 'oxygen',
      expectedMerchantId: merchant.id,
      expectedOwner: userId,
    }
  );
}
