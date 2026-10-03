import type { Mock } from 'vitest';
import { vi } from 'vitest';

export const finalizationAttempt = {
  amount: 100,
  gateway_reference: 'BAC-OLD',
  id: 'attempt-1',
  merchant_id: 'merchant-1',
  order_id: 'order-1',
  platform_fee: 2,
  status: 'pending',
} as const;

export function admittingClient(
  admitted: unknown[] | null,
  error: unknown = null
) {
  const select = vi.fn().mockResolvedValue({ data: admitted, error });
  const chain = { eq: vi.fn(), select };
  chain.eq.mockReturnValue(chain);
  return { from: vi.fn(() => ({ update: vi.fn(() => chain) })), select };
}

export function finalizationHarness(finalizePayment: Mock) {
  return {
    finalizePayment,
    hold: vi.fn().mockResolvedValue(undefined),
    scheduleAfter: vi.fn(),
    summary: {
      completed: [] as string[],
      failed: false,
      reviewsFiled: [] as string[],
    },
    supabase: {} as never,
  };
}
