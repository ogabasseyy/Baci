import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureKlumpLauncherFailed,
  captureKlumpLauncherStarted,
} from './klump-launcher-attribution';
import type { BnplLaunchOrderContext } from './bnpl-launch-context';
import { KLUMP_REDIRECT_URL_KEY, launchKlumpCheckout } from './bnpl-launch-klump';

const mockKlumpConstructor = vi.fn();
vi.mock('@/lib/klump-sdk', () => ({
  getKlumpConstructor: vi.fn(() => mockKlumpConstructor),
  getKlumpPublicKey: vi.fn(() => 'klump_test_key'),
  loadKlumpSdk: vi.fn(async () => undefined),
}));

vi.mock('./native-bnpl-bridge', () => ({
  bridgeOpenedAttemptError: vi.fn(() => false),
  notifyNativeBnplClose: vi.fn(() => false),
  notifyNativeBnplProviderOpened: vi.fn(),
}));

vi.mock('./klump-launcher-attribution', () => ({
  captureKlumpLauncherFailed: vi.fn(),
  captureKlumpLauncherStarted: vi.fn(),
}));

type WidgetArgs = {
  data: { amount: number; currency: string };
  onClose: () => void;
  onOpen: () => void;
  onError: (error: Error) => void;
};

function baseContext(): BnplLaunchOrderContext {
  return {
    order: {
      id: 'order-1',
      total: 5000,
      items: [{ name: 'Phone', price: 5000, quantity: 1 }],
    },
    trackingToken: 'tok-1',
    lookupEmail: null,
    checkoutCustomerEmail: 'buyer@example.com',
    checkoutCustomerPhone: '08010000000',
    checkoutCustomerName: 'Ada Buyer',
    klumpReference: 'klump-ref-1',
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

describe('launchKlumpCheckout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('requires a klump reference and tracking token', async () => {
    await expect(
      launchKlumpCheckout({ ...baseContext(), klumpReference: null })
    ).rejects.toThrow('Missing Klump reference or tracking token.');
    expect(mockKlumpConstructor).not.toHaveBeenCalled();
  });

  it('rejects a non-positive total without opening the widget', async () => {
    const ctx = baseContext();
    ctx.order = { id: 'order-1', total: 0 } as never;

    await launchKlumpCheckout(ctx);

    expect(ctx.setStatus).toHaveBeenCalledWith('error');
    expect(ctx.setErrorMessage).toHaveBeenCalledWith(
      'Invalid order total for Klump checkout.'
    );
    expect(mockKlumpConstructor).not.toHaveBeenCalled();
  });

  it('opens the widget with integer NGN data and records the start', async () => {
    const ctx = baseContext();
    await launchKlumpCheckout(ctx);

    expect(mockKlumpConstructor).toHaveBeenCalledTimes(1);
    const args = mockKlumpConstructor.mock.calls[0][0] as WidgetArgs;
    expect(args.data).toMatchObject({ amount: 5000, currency: 'NGN' });
    args.onOpen();
    expect(captureKlumpLauncherStarted).toHaveBeenCalledTimes(1);
  });

  it('records a web failure for an opened-then-failed attempt', async () => {
    const ctx = baseContext();
    await launchKlumpCheckout(ctx);
    const args = mockKlumpConstructor.mock.calls[0][0] as WidgetArgs;
    args.onOpen();
    args.onError(new Error('widget exploded'));

    expect(captureKlumpLauncherFailed).toHaveBeenCalledTimes(1);
    expect(ctx.setStatus).toHaveBeenCalledWith('error');
    expect(ctx.setErrorMessage).toHaveBeenCalledWith('widget exploded');
  });

  it('renders a local error when the widget closes with no redirect', async () => {
    const ctx = baseContext();
    await launchKlumpCheckout(ctx);
    const args = mockKlumpConstructor.mock.calls[0][0] as WidgetArgs;
    args.onClose();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(window.localStorage.getItem(KLUMP_REDIRECT_URL_KEY)).toBeNull();
    expect(ctx.setStatus).toHaveBeenCalledWith('error');
  });
});
