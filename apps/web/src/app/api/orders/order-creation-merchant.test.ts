import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { rejectUnavailableMobileOxygenOrder } from './mobile-oxygen-order-admission';
import { resolveOrderCreationMerchant } from './order-creation-merchant';

vi.mock('./mobile-oxygen-order-admission', () => ({
  rejectUnavailableMobileOxygenOrder: vi.fn(),
}));

const merchant = { id: 'merchant-1', slug: 'merchant-one' };

function setup(data: typeof merchant | null) {
  const single = vi.fn().mockResolvedValue({ data, error: null });
  const eq = vi.fn().mockReturnValue({ single });
  const from = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({ eq }),
  });
  const supabase = { from } as unknown as SupabaseClient;
  const args = {
    request: new Request('https://example.com/api/orders'),
    supabase,
    order: {
      merchant_id: merchant.id,
      payment_method: 'oxygen',
      source: 'mobile_app' as const,
    },
    userId: 'customer',
  };
  return { args, eq };
}

it('rejects a missing merchant before admission', async () => {
  vi.mocked(rejectUnavailableMobileOxygenOrder).mockClear();
  const { args, eq } = setup(null);

  const result = await resolveOrderCreationMerchant(args);

  expect(eq).toHaveBeenCalledWith('id', merchant.id);
  expect(result.ok ? null : result.response.status).toBe(404);
  expect(rejectUnavailableMobileOxygenOrder).not.toHaveBeenCalled();
});

it('binds the gate and successful return to the same resolved merchant', async () => {
  vi.mocked(rejectUnavailableMobileOxygenOrder).mockResolvedValueOnce(null);
  const { args, eq } = setup(merchant);

  await expect(resolveOrderCreationMerchant(args)).resolves.toEqual({
    ok: true,
    merchant,
  });
  expect(eq).toHaveBeenCalledWith('id', merchant.id);
  expect(rejectUnavailableMobileOxygenOrder).toHaveBeenCalledWith({
    request: args.request,
    client: args.supabase,
    merchant,
    userId: args.userId,
    paymentMethod: 'oxygen',
    source: 'mobile_app',
  });
});
