import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { createFundingScreenFixture } from './customer-funding-screen.test-fixture';
import { dispatchRuntimeComposition } from './runtime-composition-routes';

vi.mock('server-only', () => ({}));
const handler = vi.hoisted(() => vi.fn());
vi.mock('./customer-purchase-handler', () => ({
  createPiggyvestCustomerPurchaseHandler: handler,
}));
it('propagates only explicitly enabled payment-leg readback to purchase status', async () => {
  handler.mockReturnValue({
    status: async () => Response.json({ status: 'synthetic' }),
  });
  const common = createFundingScreenFixture().options;
  const request = new NextRequest('http://127.0.0.1/purchase/status');
  await dispatchRuntimeComposition(request, common, {
    purchase: { enabled: true },
  });
  expect(handler.mock.lastCall?.[0].paymentLegRecovery).toBeUndefined();
  await dispatchRuntimeComposition(request, common, {
    purchase: { enabled: true, paymentLegRecovery: { enabled: true } },
  });
  expect(handler.mock.lastCall?.[0].paymentLegRecovery).toEqual({
    enabled: true,
  });
});
