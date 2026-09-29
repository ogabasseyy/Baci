import type { Mock } from 'vitest';
import { vi } from 'vitest';

export function listQuery(data: unknown, error: unknown = null) {
  const builder: Record<string, unknown> = {
    limit: vi.fn().mockResolvedValue({ data, error }),
    // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are awaited thenables.
    then: (resolve: (result: unknown) => void) => resolve({ data, error }),
  };
  for (const key of ['eq', 'gt', 'is', 'not', 'select']) {
    builder[key] = vi.fn().mockReturnValue(builder);
  }
  return builder as unknown as {
    eq: Mock;
    gt: Mock;
    is: Mock;
    limit: Mock;
    not: Mock;
    select: Mock;
  };
}

export const reviewInput = {
  amount: 100,
  currency: 'NGN',
  merchantId: 'merchant-1',
  orderId: 'order-1',
  paymentId: 'payment-1',
  paymentReference: 'PSK-1',
};

export const multiLegPayments = [
  { amount: 100, gateway: 'paystack' },
  { amount: 50, gateway: 'korapay' },
];
