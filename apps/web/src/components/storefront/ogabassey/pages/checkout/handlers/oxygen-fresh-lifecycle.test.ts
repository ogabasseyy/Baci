import { expect, it, vi } from 'vitest';
vi.mock('./recover-pending-checkout-order', () => ({ recoverPendingCheckoutOrder: vi.fn(async () => ({ kind:'submit', pendingOrder:{reusableOrder:null,clearStoredOrder:false} })) }));
vi.mock('./submit-checkout-order', () => ({ submitCheckoutOrder: vi.fn(async () => ({ order:{id:'order-12345678'},wallet:null,amountDueToGateway:100,freshOrder:true })) }));
vi.mock('../persist-pending-checkout-order', () => ({ persistPendingCheckoutOrder: vi.fn() }));
vi.mock('@/lib/posthog/capture-checkout-funnel-event', () => ({ captureCheckoutFunnelEventOnce: vi.fn() }));
import { runCheckoutOrderLifecycle } from './checkout-order-lifecycle';
it('carries fresh creation into the payment lifecycle result', async () => {
 const options = { reuse:{paymentMethod:'oxygen'}, recoveryContext:{}, submit:{orderRequest:{}}, customer:{email:'a@example.com',phone:'123',merchantId:'merchant'}, fingerprint:'f', paymentMethod:'oxygen',itemCount:1,shipping:0,subtotal:100,tax:0,fallbackTotal:100,currencyFallback:'NGN',shippingAddress:{address:'a',city:'b',state:'c'},merchantCountry:'NG',onRedvaultSummary:vi.fn(),onOrderCreated:vi.fn(),onPendingSnapshot:vi.fn(),redvaultReview:{enabled:false,customerName:'A',checkoutFingerprint:'f',setReady:vi.fn(),releaseSubmission:vi.fn()} };
 await expect(runCheckoutOrderLifecycle(options as never)).resolves.toMatchObject({kind:'payment_ready',freshOrder:true});
});
