import { act, renderHook } from '@testing-library/react-native';
import { usePendingSavingsStatusCheck } from './use-pending-savings-status-check';

const PILOT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const OPERATION = '22222222-2222-4222-8222-222222222222';

// The real status read, check and deadline; only the network is faked.
const mockFetchJson = jest.fn<Promise<unknown>, [Record<string, unknown>]>();
jest.mock('@/lib/storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: () => ({ fetchJson: mockFetchJson }),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'user-a' } }) },
}));
let mockVerdict: boolean | null = true;
jest.mock('@/lib/read-piggyvest-capability-now', () => ({
  readPiggyvestCapabilityNow: () => mockVerdict,
}));
jest.mock('@/hooks/use-haptics', () => ({ triggerHaptic: () => undefined }));
const mockNotify = jest.fn();
jest.mock('./savings/savings-notice', () => ({
  notifySavings: (...args: unknown[]) => mockNotify(...args),
  savingsNotifier: () => mockNotify,
}));

function setup(operationId: string | null = OPERATION) {
  const props = {
    goal: null,
    merchantId: PILOT,
    idempotencyKeyRef: { current: operationId },
    operationRailRef: {
      current: operationId ? ('primary' as const) : null,
    } as { current: 'primary' | 'legacy' | null },
    submittingRef: { current: false },
    refetchWallet: jest.fn(async () => undefined),
    setSavingsContributionAmount: jest.fn(),
  };
  const view = renderHook(() => usePendingSavingsStatusCheck(props));
  return { props, view };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockVerdict = true;
});
afterEach(() => jest.useRealTimers());

it('reads the status of the stored operation only (a PATCH, never a new transfer)', async () => {
  mockFetchJson.mockResolvedValue({
    operationId: OPERATION,
    status: 'pending',
  });
  const { props, view } = setup();
  let outcome: unknown;
  await act(async () => {
    outcome = await view.result.current.checkStatus();
  });
  expect(outcome).toBe('pending');
  expect(mockFetchJson).toHaveBeenCalledTimes(1);
  expect(mockFetchJson.mock.calls[0]?.[0]).toMatchObject({
    method: 'PATCH',
    path: '/api/storefront/customer/savings/primary-transfer',
    body: { merchantId: PILOT, operationId: OPERATION },
  });
  expect(props.idempotencyKeyRef.current).toBe(OPERATION);
  expect(view.result.current.isCheckingStatus).toBe(false);
});

it('does nothing without a stored operation id', async () => {
  const { view } = setup(null);
  let outcome: unknown;
  await act(async () => {
    outcome = await view.result.current.checkStatus();
  });
  expect(outcome).toBe('no-operation');
  expect(mockFetchJson).not.toHaveBeenCalled();
  expect(mockNotify).not.toHaveBeenCalled();
});

it('never checks a legacy id (only its own add retries it)', async () => {
  const { props, view } = setup();
  props.operationRailRef.current = 'legacy';
  await act(async () => {
    expect(await view.result.current.checkStatus()).toBe('no-operation');
  });
  expect(mockFetchJson).not.toHaveBeenCalled();
});

it('keeps a primary id whose rail is gone, without a read', async () => {
  mockVerdict = false;
  const { props, view } = setup();
  await act(async () => {
    expect(await view.result.current.checkStatus()).toBe('blocked');
  });
  expect(mockFetchJson).not.toHaveBeenCalled();
  expect(props.idempotencyKeyRef.current).toBe(OPERATION);
});

it('warns "Still checking" once per operation while the rail stays blocked', async () => {
  mockVerdict = false;
  const { view } = setup();
  await act(async () => {
    await view.result.current.checkStatus();
    await view.result.current.checkStatus();
    await view.result.current.checkStatus();
  });
  expect(mockNotify).toHaveBeenCalledTimes(1);
  expect(mockNotify).toHaveBeenCalledWith(
    'Still checking',
    expect.any(String),
    'warning'
  );
});

it('drops "still waiting" news from a read that ends after the wallet left', async () => {
  jest.useFakeTimers();
  mockFetchJson.mockImplementation(() => new Promise(() => undefined));
  const { view } = setup();
  let check: Promise<unknown> = Promise.resolve();
  await act(async () => {
    check = view.result.current.checkStatus();
  });
  view.unmount();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(15_000);
  });
  expect(await check).toBe('unavailable');
  expect(mockNotify).not.toHaveBeenCalled();
});

it('an automatic read posts no "still waiting" notice; a tap does', async () => {
  mockFetchJson.mockResolvedValue({
    status: 'pending',
    operationId: OPERATION,
  });
  const { view } = setup();
  await act(async () => {
    expect(await view.result.current.checkStatus({ automatic: true })).toBe(
      'pending'
    );
  });
  expect(mockNotify).not.toHaveBeenCalled();
  await act(async () => {
    expect(await view.result.current.checkStatus()).toBe('pending');
  });
  expect(mockNotify).toHaveBeenCalledWith(
    'Contribution pending',
    expect.any(String),
    'info'
  );
});

it("answers busy, not no-operation, while this screen's own add is sending", async () => {
  const { props, view } = setup();
  props.submittingRef.current = true;
  await act(async () => {
    expect(await view.result.current.checkStatus()).toBe('busy');
  });
  expect(mockFetchJson).not.toHaveBeenCalled();
});

it('posts nothing when another operation took over before the answer came', async () => {
  let answer: (value: unknown) => void = () => undefined;
  mockFetchJson.mockReturnValue(
    new Promise((resolve) => {
      answer = resolve;
    })
  );
  const { props, view } = setup();
  let check: Promise<unknown> = Promise.resolve();
  await act(async () => {
    check = view.result.current.checkStatus();
  });
  // Another account, merchant or goal took over the screen meanwhile.
  props.idempotencyKeyRef.current = '33333333-3333-4333-8333-333333333333';
  await act(async () => {
    answer({ status: 'confirmed', operationId: OPERATION });
    await check;
  });
  expect(mockNotify).not.toHaveBeenCalled();
  expect(props.idempotencyKeyRef.current).toBe(
    '33333333-3333-4333-8333-333333333333'
  );
});

it('runs one read at a time', async () => {
  let finish: (value: unknown) => void = () => undefined;
  mockFetchJson.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const { view } = setup();
  let first: Promise<unknown> = Promise.resolve();
  await act(async () => {
    first = view.result.current.checkStatus();
  });
  expect(view.result.current.isCheckingStatus).toBe(true);
  await act(async () => {
    expect(await view.result.current.checkStatus()).toBe('busy');
  });
  expect(mockFetchJson).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish({ operationId: OPERATION, status: 'pending' });
    await first;
  });
  expect(view.result.current.isCheckingStatus).toBe(false);
});

it('gives up on a hung read after 15 s, clears Checking and keeps the operation', async () => {
  jest.useFakeTimers();
  // Incident 2026-11-17: CSRF answered, the PATCH never went out.
  mockFetchJson.mockImplementation(() => new Promise(() => undefined));
  const { props, view } = setup();
  let check: Promise<unknown> = Promise.resolve();
  await act(async () => {
    check = view.result.current.checkStatus();
  });
  expect(view.result.current.isCheckingStatus).toBe(true);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(15_000);
  });
  await act(async () => {
    expect(await check).toBe('unavailable');
  });
  expect(view.result.current.isCheckingStatus).toBe(false);
  expect(props.idempotencyKeyRef.current).toBe(OPERATION);
  expect(props.setSavingsContributionAmount).not.toHaveBeenCalled();
  expect(mockNotify).toHaveBeenCalledWith(
    'Status unavailable',
    expect.any(String),
    'warning'
  );
  expect(mockNotify).not.toHaveBeenCalledWith(
    'Savings updated',
    expect.anything(),
    expect.anything()
  );
});

it('settles a confirmed contribution: operation and amount cleared, success notice', async () => {
  mockFetchJson.mockResolvedValue({
    operationId: OPERATION,
    status: 'confirmed',
  });
  const { props, view } = setup();
  await act(async () => {
    expect(await view.result.current.checkStatus()).toBe('confirmed');
  });
  expect(props.idempotencyKeyRef.current).toBeNull();
  expect(props.operationRailRef.current).toBeNull();
  expect(props.setSavingsContributionAmount).toHaveBeenCalledWith('');
  expect(mockNotify).toHaveBeenCalledWith(
    'Savings updated',
    expect.any(String),
    'success'
  );
});
