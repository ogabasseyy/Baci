import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BnplLaunchOrderContext } from './bnpl-launch-context';
import { launchCreditDirectCheckout } from './bnpl-launch-credit-direct';

const mockOpenCreditDirectCheckout = vi.fn();
vi.mock('@/lib/credit-direct-client', () => ({
  openCreditDirectCheckout: (...args: unknown[]) =>
    mockOpenCreditDirectCheckout(...args),
}));

vi.mock('@/lib/api-client', () => ({
  apiPost: vi.fn(),
}));

vi.mock('./credit-direct-client-completion', () => ({
  captureCreditDirectClientCompletion: vi.fn((input: { orderId: string }) => ({
    orderId: input.orderId,
    source: 'sdk_success',
  })),
}));

vi.mock('./native-bnpl-bridge', () => ({
  bridgeOpenedAttemptError: vi.fn(() => false),
  notifyNativeBnplClose: vi.fn(() => false),
  notifyNativeBnplProviderOpened: vi.fn(),
}));

type OpenArgs = {
  onSuccess: (data: { checkoutTransactionId?: string; sessionId: string }) => void;
  onClose: () => void;
};

function baseContext(): BnplLaunchOrderContext {
  return {
    order: {
      id: 'order-1',
      total: 5000,
      tracking_token: 'tok-1',
      items: [{ product_id: 'p1', product_name: 'Phone', price: 5000, quantity: 1 }],
    },
    trackingToken: null,
    lookupEmail: null,
    checkoutCustomerEmail: 'buyer@example.com',
    checkoutCustomerPhone: '08010000000',
    checkoutCustomerName: 'Ada Buyer',
    klumpReference: null,
    slug: 'test-store',
    paymentLaunchKeyRef: { current: null as string | null },
    providerOpenedLaunchKeyRef: { current: null as string | null },
    klumpSuccessRedirectRef: { current: false },
    router: { push: vi.fn() },
    setStatus: vi.fn(),
    setErrorMessage: vi.fn(),
    setCreditDirectPopupMarker: vi.fn(),
  } as never;
}

describe('launchCreditDirectCheckout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a non-positive order total', async () => {
    await expect(
      launchCreditDirectCheckout({
        ...baseContext(),
        order: { id: 'order-1', total: 0, items: [] },
      })
    ).rejects.toThrow('Invalid order total for Credit Direct checkout.');
    expect(mockOpenCreditDirectCheckout).not.toHaveBeenCalled();
  });

  it('skips a duplicate launch for the same order', async () => {
    const ctx = baseContext();
    await launchCreditDirectCheckout(ctx);
    await launchCreditDirectCheckout(ctx);

    expect(mockOpenCreditDirectCheckout).toHaveBeenCalledTimes(1);
  });

  it('stores the completion marker on provider success', async () => {
    const ctx = baseContext();
    await launchCreditDirectCheckout(ctx);
    const args = mockOpenCreditDirectCheckout.mock.calls[0][0] as OpenArgs;
    args.onSuccess({ checkoutTransactionId: 'txn-1', sessionId: 'sess-1' });

    expect(ctx.setCreditDirectPopupMarker).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1' })
    );
  });

  it('renders a local error when the popup closes without native handling', async () => {
    const ctx = baseContext();
    await launchCreditDirectCheckout(ctx);
    const args = mockOpenCreditDirectCheckout.mock.calls[0][0] as OpenArgs;
    args.onClose();
    // The close path defers one macrotask (and yields to Klump embeds).
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ctx.setStatus).toHaveBeenCalledWith('error');
    expect(ctx.setErrorMessage).toHaveBeenCalledWith(
      'Payment cancelled. Please try again.'
    );
  });
});
