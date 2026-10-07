import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { openSavingsFirstCardBrowser } from '@/lib/savings-first-card-browser';
import {
  getSavingsFirstCardCapability,
  refreshSavingsFirstCardCheckout,
  startSavingsFirstCardCheckout,
} from '@/lib/savings-first-card-checkout';
import {
  clearRetiredSavingsFirstCardCheckoutSnapshot,
  readSavingsFirstCardCheckoutSnapshot,
  recordSavingsFirstCardCheckoutState,
  type SavingsFirstCardCheckoutSnapshot,
  saveSavingsFirstCardCheckoutSnapshot,
} from '@/lib/savings-first-card-checkout-snapshot';
import { useSavingsFirstCardCheckout } from './use-savings-first-card-checkout';

jest.mock('@/lib/savings-first-card-checkout', () => ({
  getSavingsFirstCardCapability: jest.fn(),
  refreshSavingsFirstCardCheckout: jest.fn(),
  startSavingsFirstCardCheckout: jest.fn(),
}));
jest.mock('@/lib/savings-first-card-browser', () => ({
  openSavingsFirstCardBrowser: jest.fn(),
}));
jest.mock('@/lib/savings-first-card-checkout-snapshot', () => ({
  clearRetiredSavingsFirstCardCheckoutSnapshot: jest.fn(),
  readSavingsFirstCardCheckoutSnapshot: jest.fn(),
  recordSavingsFirstCardCheckoutState: jest.fn(),
  saveSavingsFirstCardCheckoutSnapshot: jest.fn(),
}));

const goalA = '00000000-0000-4000-8000-000000000001';
const goalB = '00000000-0000-4000-8000-000000000002';
const intentId = '00000000-0000-4000-8000-000000000003';
const idempotencyKey = '00000000-0000-4000-8000-000000000004';
const state = {
  intentId,
  goalId: goalA,
  amountKobo: 12500,
  currency: 'NGN' as const,
  status: 'ready' as const,
  authorizationUrl: 'https://checkout.paystack.com/access123',
};
const saved = {
  goalId: goalA,
  amountKobo: 12500,
  idempotencyKey,
  consent: {
    version: 'prefunded-first-card-v1' as const,
    oneTimeCharge: true as const,
    saveCard: true as const,
  },
  intentId,
  status: 'ready' as const,
  authorizationUrl: state.authorizationUrl,
};
const input = {
  amount: '125',
  goalId: goalA,
  merchantId: 'merchant-a',
  onAmountChange: jest.fn(),
  remainingAmount: 1000,
  userId: 'user-a',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(readSavingsFirstCardCheckoutSnapshot).mockResolvedValue(null);
  jest
    .mocked(getSavingsFirstCardCapability)
    .mockImplementation(async ({ goalId }) => ({
      goalId,
      enabled: true,
      maximumAmountKobo: 500000,
      currency: 'NGN',
    }));
  jest.mocked(saveSavingsFirstCardCheckoutSnapshot).mockResolvedValue({
    ...saved,
    intentId: null,
    status: undefined,
    authorizationUrl: undefined,
  });
  jest.mocked(recordSavingsFirstCardCheckoutState).mockResolvedValue(saved);
  jest.mocked(startSavingsFirstCardCheckout).mockResolvedValue(state);
  jest.mocked(refreshSavingsFirstCardCheckout).mockResolvedValue(state);
  jest
    .mocked(openSavingsFirstCardBrowser)
    .mockResolvedValue({ type: 'cancel' } as never);
});

it('posts only after the same durable idempotency snapshot is saved once on double tap', async () => {
  const write = deferred<SavingsFirstCardCheckoutSnapshot>();
  jest
    .mocked(saveSavingsFirstCardCheckoutSnapshot)
    .mockReturnValueOnce(write.promise);
  const { result } = renderHook(() => useSavingsFirstCardCheckout(input));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  let first!: Promise<void>;
  let second!: Promise<void>;
  act(() => {
    first = result.current.begin();
    second = result.current.begin();
  });
  expect(saveSavingsFirstCardCheckoutSnapshot).toHaveBeenCalledTimes(1);
  expect(startSavingsFirstCardCheckout).not.toHaveBeenCalled();
  await act(async () => {
    write.resolve({
      ...saved,
      intentId: null,
      status: undefined,
      authorizationUrl: undefined,
    });
    await Promise.all([first, second]);
  });
  expect(startSavingsFirstCardCheckout).toHaveBeenCalledTimes(1);
  expect(startSavingsFirstCardCheckout).toHaveBeenCalledWith(
    expect.objectContaining({
      request: expect.objectContaining({ idempotencyKey }),
    })
  );
});

it('treats browser cancellation as pending until the server confirms completion', async () => {
  jest.mocked(refreshSavingsFirstCardCheckout).mockResolvedValue({
    ...state,
    status: 'pending',
    authorizationUrl: undefined,
  });
  const { result } = renderHook(() => useSavingsFirstCardCheckout(input));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => {
    await result.current.begin();
  });
  expect(openSavingsFirstCardBrowser).toHaveBeenCalledWith(
    state.authorizationUrl
  );
  expect(refreshSavingsFirstCardCheckout).toHaveBeenCalledWith(
    expect.objectContaining({
      selection: { intentId, goalId: goalA },
    })
  );
  expect(result.current.status).toBe('pending');
  expect(result.current.message).toMatch(/pending confirmation/);
  expect(result.current.status).not.toBe('completed');
});

it('does not refresh an old intent when checkout closes after switching goals', async () => {
  const browser = deferred<never>();
  jest.mocked(openSavingsFirstCardBrowser).mockReturnValueOnce(browser.promise);
  const { result, rerender } = renderHook(
    (props: typeof input) => useSavingsFirstCardCheckout(props),
    { initialProps: input }
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  let opening!: Promise<void>;
  act(() => {
    opening = result.current.begin();
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(openSavingsFirstCardBrowser).toHaveBeenCalledTimes(1);
  rerender({ ...input, goalId: goalB });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  jest.mocked(refreshSavingsFirstCardCheckout).mockClear();
  await act(async () => {
    browser.resolve(undefined as never);
    await opening;
  });
  expect(refreshSavingsFirstCardCheckout).not.toHaveBeenCalled();
});

it('keeps saved intent recovery available when the capability is later disabled', async () => {
  jest.mocked(readSavingsFirstCardCheckoutSnapshot).mockResolvedValue(saved);
  jest.mocked(getSavingsFirstCardCapability).mockResolvedValue({
    goalId: goalA,
    enabled: false,
    maximumAmountKobo: 0,
    currency: 'NGN',
  });
  const { result } = renderHook(() => useSavingsFirstCardCheckout(input));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(result.current.enabled).toBe(false);
  await act(async () => {
    await result.current.begin();
  });
  expect(openSavingsFirstCardBrowser).toHaveBeenCalledWith(
    state.authorizationUrl
  );
  expect(startSavingsFirstCardCheckout).not.toHaveBeenCalled();
});

it('fails closed when saved payment state cannot be read', async () => {
  jest
    .mocked(readSavingsFirstCardCheckoutSnapshot)
    .mockRejectedValue(new Error('storage unavailable'));
  const { result } = renderHook(() => useSavingsFirstCardCheckout(input));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(result.current.recoveryBlocked).toBe(true);
  expect(result.current.enabled).toBe(false);
  expect(getSavingsFirstCardCapability).not.toHaveBeenCalled();
  await act(async () => {
    await result.current.begin();
  });
  expect(startSavingsFirstCardCheckout).not.toHaveBeenCalled();
});

it('refreshes a saved intent after app resume', async () => {
  jest.mocked(readSavingsFirstCardCheckoutSnapshot).mockResolvedValue(saved);
  const listeners: ((state: AppStateStatus) => void)[] = [];
  const appStateSpy = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      listeners.push(listener);
      return { remove: jest.fn() } as never;
    });
  const { unmount } = renderHook(() => useSavingsFirstCardCheckout(input));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  jest.mocked(refreshSavingsFirstCardCheckout).mockClear();
  await act(async () => {
    listeners.at(-1)?.('background');
    listeners.at(-1)?.('active');
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(refreshSavingsFirstCardCheckout).toHaveBeenCalledTimes(1);
  unmount();
  appStateSpy.mockRestore();
});

it('starts a new idempotency request only after the old checkout is retired', async () => {
  const appStateSpy = jest
    .spyOn(AppState, 'addEventListener')
    .mockReturnValue({ remove: jest.fn() } as never);
  const oldCheckout = {
    ...saved,
    status: 'pending' as const,
    authorizationUrl: undefined,
  };
  const newKey = '00000000-0000-4000-8000-000000000099';
  jest
    .mocked(readSavingsFirstCardCheckoutSnapshot)
    .mockResolvedValue(oldCheckout);
  jest.mocked(refreshSavingsFirstCardCheckout).mockResolvedValue({
    ...state,
    status: 'retired_unconfirmed',
    authorizationUrl: undefined,
  });
  jest.mocked(saveSavingsFirstCardCheckoutSnapshot).mockResolvedValueOnce({
    ...saved,
    idempotencyKey: newKey,
    intentId: null,
    status: undefined,
    authorizationUrl: undefined,
  });
  const { result } = renderHook(() => useSavingsFirstCardCheckout(input));

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(clearRetiredSavingsFirstCardCheckoutSnapshot).toHaveBeenCalledWith(
    expect.objectContaining({ goalId: goalA }),
    idempotencyKey,
    intentId
  );
  expect(result.current.snapshot).toBeNull();
  expect(result.current.status).toBe('retired_unconfirmed');
  expect(result.current.message).toMatch(/closed for review/i);
  expect(startSavingsFirstCardCheckout).not.toHaveBeenCalled();

  await act(async () => {
    await result.current.begin();
  });

  expect(saveSavingsFirstCardCheckoutSnapshot).toHaveBeenCalledTimes(1);
  expect(startSavingsFirstCardCheckout).toHaveBeenCalledWith(
    expect.objectContaining({
      request: expect.objectContaining({ idempotencyKey: newKey }),
    })
  );
  appStateSpy.mockRestore();
});

it('refreshes and clears a retired response from same-key start without posting again', async () => {
  const appStateSpy = jest
    .spyOn(AppState, 'addEventListener')
    .mockReturnValue({ remove: jest.fn() } as never);
  const oldCheckout = {
    ...saved,
    intentId: null,
    status: undefined,
    authorizationUrl: undefined,
  };
  const retired = {
    ...state,
    status: 'retired_unconfirmed' as const,
    authorizationUrl: undefined,
  };
  jest
    .mocked(readSavingsFirstCardCheckoutSnapshot)
    .mockResolvedValue(oldCheckout);
  jest.mocked(startSavingsFirstCardCheckout).mockResolvedValue(retired);
  jest.mocked(refreshSavingsFirstCardCheckout).mockResolvedValue(retired);
  const { result } = renderHook(() => useSavingsFirstCardCheckout(input));

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => {
    await result.current.begin();
  });

  expect(startSavingsFirstCardCheckout).toHaveBeenCalledTimes(1);
  expect(refreshSavingsFirstCardCheckout).toHaveBeenCalledWith(
    expect.objectContaining({ selection: { intentId, goalId: goalA } })
  );
  expect(clearRetiredSavingsFirstCardCheckoutSnapshot).toHaveBeenCalledWith(
    expect.objectContaining({ goalId: goalA }),
    idempotencyKey,
    intentId
  );
  expect(saveSavingsFirstCardCheckoutSnapshot).not.toHaveBeenCalled();
  expect(result.current.snapshot).toBeNull();
  expect(result.current.status).toBe('retired_unconfirmed');
  appStateSpy.mockRestore();
});
