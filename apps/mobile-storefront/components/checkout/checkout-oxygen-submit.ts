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

type OxygenOrderItem = CreateOrderRequest['items'][number] & {
  voucherToken?: unknown;
  voucherAwardId?: unknown;
};

const OXYGEN_VOUCHER_FIELDS = [
  'voucher_token',
  'voucher_award_id',
  'voucherToken',
  'voucherAwardId',
] as const;

function prepareOxygenOrderItem(
  item: OxygenOrderItem
): CreateOrderRequest['items'][number] {
  const cleanedItem: Record<string, unknown> = { ...item };
  for (const voucherField of OXYGEN_VOUCHER_FIELDS) {
    const value = cleanedItem[voucherField];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') {
      // Preserve cause field name for malformed cart diagnostics without logging the code.
      throw new Error('Invalid voucher identifier', { cause: voucherField });
    }
    const trimmed = value.trim();
    if (!trimmed) {
      delete cleanedItem[voucherField];
      continue;
    }
    cleanedItem[voucherField] = trimmed;
  }
  return cleanedItem as CreateOrderRequest['items'][number];
}

export async function submitOxygenCheckout(
  input: Input,
  dependencies?: Dependencies
) {
  // This client check provides early feedback. POST /api/orders enforces admission.
  if (!input.isAuthenticated || input.request.payment_method !== 'oxygen') {
    throw new Error('Oxygen requires a signed-in customer');
  }
  const items = input.request.items.map((item) =>
    prepareOxygenOrderItem(item as OxygenOrderItem)
  );
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
  const appliedCredit =
    (result.wallet?.amountUsed ?? 0) + (result.savings?.amountUsed ?? 0);
  const resolvedAmountDue =
    result.amountDueToGateway ?? Math.max(0, order.total - appliedCredit);
  if (order.total <= 0 || resolvedAmountDue <= 0) {
    return {
      ...result,
      amountDueToGateway: 0,
    };
  }
  return result.amountDueToGateway !== undefined
    ? result
    : {
        ...result,
        amountDueToGateway: resolvedAmountDue,
      };
}
