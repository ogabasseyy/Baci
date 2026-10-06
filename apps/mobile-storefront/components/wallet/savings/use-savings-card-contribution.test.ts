import { act, renderHook } from '@testing-library/react-native';
import {
  readSavingsCardContributionSnapshot,
  saveSavingsCardContributionSnapshot,
} from '@/lib/savings-card-contribution-snapshot';
import {
  getSavingsCardContributionOptions,
  getSavingsCardContributionStatus,
  submitSavingsCardContribution,
} from '@/lib/savings-card-contributions';
import { useSavingsCardContribution } from './use-savings-card-contribution';

jest.mock('@/lib/savings-card-contributions', () => ({
  getSavingsCardContributionOptions: jest.fn(),
  getSavingsCardContributionStatus: jest.fn(),
  submitSavingsCardContribution: jest.fn(),
}));
jest.mock('@/lib/savings-card-contribution-snapshot', () => ({
  clearTerminalSavingsCardContributionSnapshot: jest.fn(),
  readSavingsCardContributionSnapshot: jest.fn(),
  saveSavingsCardContributionSnapshot: jest.fn(),
}));

const goalA = '00000000-0000-4000-8000-000000000001';
const goalB = '00000000-0000-4000-8000-000000000004';
const methodId = '00000000-0000-4000-8000-000000000002';
const saved = {
  goalId: goalA,
  savedMethodId: methodId,
  amountKobo: 10000,
  idempotencyKey: '00000000-0000-4000-8000-000000000003',
  consent: {
    version: 'prefunded-card-v1' as const,
    oneTimeCharge: true as const,
  },
};
const readyOptions = (goalId: string) => ({
  goalId,
  enabled: true,
  newCardEnabled: false as const,
  currency: 'NGN' as const,
  maximumAmountKobo: 500000,
  savedMethods: [{ id: methodId, brand: 'Visa', last4: '4242' }],
});
const input = {
  amount: '100',
  goalId: goalA,
  merchantId: 'merchant-1',
  onAmountChange: jest.fn(),
  remainingAmount: 5000,
  userId: 'customer-1',
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
  jest.mocked(readSavingsCardContributionSnapshot).mockResolvedValue(null);
  jest
    .mocked(getSavingsCardContributionOptions)
    .mockImplementation(async ({ goalId }) => readyOptions(goalId));
});

it('permits ten kobo when remaining naira is 0.30 minus 0.20', async () => {
  jest
    .mocked(saveSavingsCardContributionSnapshot)
    .mockResolvedValue({ ...saved, amountKobo: 10 });
  const { result } = renderHook(() =>
    useSavingsCardContribution({
      ...input,
      amount: '0.10',
      remainingAmount: 0.3 - 0.2,
    })
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  act(() => result.current.selectMethod(methodId));
  await act(async () => {
    await result.current.beginContribution();
  });
  expect(result.current.limitKobo).toBe(10);
  expect(submitSavingsCardContribution).toHaveBeenCalledWith(
    expect.objectContaining({
      request: expect.objectContaining({ amountKobo: 10 }),
    })
  );
});

it.each([
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  -1,
  Number.MAX_VALUE,
])('blocks new contributions for invalid remaining amount %s', async (remainingAmount) => {
  const { result } = renderHook(() =>
    useSavingsCardContribution({ ...input, remainingAmount })
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  act(() => result.current.selectMethod(methodId));
  await act(async () => {
    await result.current.beginContribution();
  });
  expect(result.current.limitKobo).toBe(0);
  expect(saveSavingsCardContributionSnapshot).not.toHaveBeenCalled();
  expect(submitSavingsCardContribution).not.toHaveBeenCalled();
});

it('aborts and ignores capability responses from a previous goal scope', async () => {
  const oldResponse = deferred<ReturnType<typeof readyOptions>>();
  jest
    .mocked(getSavingsCardContributionOptions)
    .mockReturnValueOnce(oldResponse.promise)
    .mockResolvedValueOnce(readyOptions(goalB));
  const { result, rerender } = renderHook(
    (props: typeof input) => useSavingsCardContribution(props),
    { initialProps: input }
  );
  await act(async () => {
    await Promise.resolve();
  });
  const oldSignal = jest.mocked(getSavingsCardContributionOptions).mock
    .calls[0]?.[0].signal;
  rerender({ ...input, goalId: goalB });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  oldResponse.resolve(readyOptions(goalA));
  await act(async () => {
    await Promise.resolve();
  });
  expect(oldSignal?.aborted).toBe(true);
  expect(result.current.methods).toEqual(readyOptions(goalB).savedMethods);
});

it('does not dispatch after the scope changes while the durable snapshot write is pending', async () => {
  const write = deferred<typeof saved>();
  jest
    .mocked(saveSavingsCardContributionSnapshot)
    .mockReturnValueOnce(write.promise);
  const { result, rerender } = renderHook(
    (props: typeof input) => useSavingsCardContribution(props),
    { initialProps: input }
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  act(() => result.current.selectMethod(methodId));
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.beginContribution();
  });
  rerender({ ...input, goalId: goalB });
  await act(async () => {
    write.resolve(saved);
    await pending;
    await Promise.resolve();
  });
  expect(submitSavingsCardContribution).not.toHaveBeenCalled();
  expect(getSavingsCardContributionStatus).not.toHaveBeenCalled();
});

it('does not dispatch an old write after an A to B to A scope cycle', async () => {
  const write = deferred<typeof saved>();
  jest
    .mocked(saveSavingsCardContributionSnapshot)
    .mockReturnValueOnce(write.promise);
  const { result, rerender } = renderHook(
    (props: typeof input) => useSavingsCardContribution(props),
    { initialProps: input }
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  act(() => result.current.selectMethod(methodId));
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.beginContribution();
  });
  rerender({ ...input, goalId: goalB });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  rerender(input);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => {
    write.resolve(saved);
    await pending;
  });
  expect(submitSavingsCardContribution).not.toHaveBeenCalled();
  expect(getSavingsCardContributionStatus).not.toHaveBeenCalled();
});

it('refreshes newly saved methods without resetting a saved contribution operation', async () => {
  const savedSnapshot = saved;
  const operation = {
    goalId: goalA,
    operationId: 'operation-1',
    amountKobo: 10000,
    currency: 'NGN' as const,
    status: 'pending' as const,
  };
  jest
    .mocked(readSavingsCardContributionSnapshot)
    .mockResolvedValue(savedSnapshot);
  jest.mocked(getSavingsCardContributionStatus).mockResolvedValue(operation);
  const { result: recovered } = renderHook(() =>
    useSavingsCardContribution(input)
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  jest.mocked(getSavingsCardContributionOptions).mockResolvedValue({
    ...readyOptions(goalA),
    savedMethods: [{ id: methodId, brand: 'Visa', last4: '1111' }],
  });

  await act(async () => {
    await recovered.current.refreshMethods();
  });

  expect(recovered.current.methods).toEqual([
    { id: methodId, brand: 'Visa', last4: '1111' },
  ]);
  expect(recovered.current.snapshot).toEqual(savedSnapshot);
  expect(recovered.current.operation).toEqual(operation);
});
