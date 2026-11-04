import { beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({capture:vi.fn()}));
vi.mock('@/components/payments/oxygen/oxygen-checkout-snapshot',()=>({captureOxygenCheckoutSnapshot:mocks.capture}));
import { dispatchCheckoutPayment } from './dispatch-checkout-payment';
import { paymentDispatchContext } from './checkout-payment-dispatch-context.test-support';
beforeEach(()=>vi.clearAllMocks());
it.each([true, false, undefined])('captures an Oxygen cart only when fresh order flag is %s', async (freshOrder) => {
 const context = {...paymentDispatchContext(),paymentMethod:'oxygen' as const,freshOrder};
 await dispatchCheckoutPayment(context);
 expect(mocks.capture).toHaveBeenCalledTimes(freshOrder === true ? 1 : 0);
});
it('does not capture shared cart lines even for a fresh order', async () => {
 const context = {...paymentDispatchContext(),paymentMethod:'oxygen' as const,freshOrder:true,orderItems:[{cart_line_id:'server-line'} as never]};
 await dispatchCheckoutPayment(context);
 expect(mocks.capture).not.toHaveBeenCalled();
});
