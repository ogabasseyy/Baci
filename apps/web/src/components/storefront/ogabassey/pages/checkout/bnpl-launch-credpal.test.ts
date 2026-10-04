import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureBnplPaymentCompleted } from './capture-bnpl-payment-completed';
import type { BnplLaunchOrderContext } from './bnpl-launch-context';
import { launchCredPalCheckout } from './bnpl-launch-credpal';

const mockOpenCredPalCheckout = vi.fn();
vi.mock('@/lib/credpal', () => ({
  openCredPalCheckout: (...args: unknown[]) =>
    mockOpenCredPalCheckout(...args),
  getCredPalKey: vi.fn(() => 'credpal_test_key'),
}));

vi.mock('./capture-bnpl-payment-completed', () => ({
  captureBnplPaymentCompleted: vi.fn(),
}));

vi.mock('./native-bnpl-bridge', () => ({
  bridgeOpenedAttemptError: vi.fn(() => false),
  notifyNativeBnplClose: vi.fn(() => false),
  notifyNativeBnplProviderOpened: vi.fn(),
}));

type OpenArgs = {
  onLoad: () => void;
  onSuccess: (data: { status?: string; order_no: string }) => void;
  onClose: () => void;
  onError: (error: Error) => void;
};

function baseContext(): BnplLaunchOrderContext {
  return {
    order: { id: 'order-1', total: 5000, tracking_token: 'tok-1' },
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

describe('launchCredPalCheckout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a non-positive order total', async () => {
    await expect(
      launchCredPalCheckout({
        ...baseContext(),
        order: { id: 'order-1', total: 0, items: [] },
      })
    ).rejects.toThrow('Invalid order total for CredPal checkout.');
    expect(mockOpenCredPalCheckout).not.toHaveBeenCalled();
  });

  it('skips a duplicate launch for the same order', async () => {
    const ctx = baseContext();
    await launchCredPalCheckout(ctx);
    await launchCredPalCheckout(ctx);

    expect(mockOpenCredPalCheckout).toHaveBeenCalledTimes(1);
  });

  it('records the conversion and routes on provider success', async () => {
    const ctx = baseContext();
    await launchCredPalCheckout(ctx);
    const args = mockOpenCredPalCheckout.mock.calls[0][0] as OpenArgs;
    args.onSuccess({ status: 'success', order_no: 'CP-1' });

    expect(captureBnplPaymentCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        paymentMethod: 'credpal',
        reference: 'CP-1',
      })
    );
    expect(ctx.router.push).toHaveBeenCalledWith(
      expect.stringContaining('/order-success?')
    );
  });

  it('renders a local error when the widget closes without native handling', async () => {
    const ctx = baseContext();
    await launchCredPalCheckout(ctx);
    const args = mockOpenCredPalCheckout.mock.calls[0][0] as OpenArgs;
    args.onClose();

    expect(ctx.setStatus).toHaveBeenCalledWith('error');
    expect(ctx.setErrorMessage).toHaveBeenCalledWith('Payment cancelled.');
  });
});
