import { act, renderHook, waitFor } from '@testing-library/react-native';
import { usePrimarySavingsRecovery } from './use-primary-savings-recovery';

const mockRecover = jest.fn();
jest.mock('@/lib/piggyvest-primary-savings-recovery', () => ({
  recoverPiggyvestPrimarySavings: (...args: unknown[]) => mockRecover(...args),
}));
const mockUseCapability = jest.fn();
jest.mock('@/lib/piggyvest-primary-capability', () => {
  const actual = jest.requireActual(
    '@/lib/piggyvest-primary-capability'
  ) as typeof import('@/lib/piggyvest-primary-capability');
  return {
    ...actual,
    usePiggyvestPrimaryCapability: (...args: unknown[]) =>
      mockUseCapability(...args),
  };
});
const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const input = () => ({
  merchantId,
  userId: 'user-1',
  goalId: 'goal-1',
  operationRef: { current: null as string | null },
  setAmount: jest.fn(),
});
beforeEach(() => {
  jest.resetAllMocks();
  mockUseCapability.mockReturnValue(null);
});
it('restores a server-owned pending operation after restarting the screen', async () => {
  const props = input();
  mockRecover.mockResolvedValue({
    operationId: 'existing-operation',
    goalId: props.goalId,
    amountKobo: 12500,
    state: 'dispatched',
  });
  const { result } = renderHook(() => usePrimarySavingsRecovery(props));
  expect(result.current.ready).toBe(false);
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(props.operationRef.current).toBe('existing-operation');
  expect(props.setAmount).toHaveBeenCalledWith('125');
});
it('keeps submission blocked after recovery fails and supports a read-only retry', async () => {
  mockRecover
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValueOnce(null);
  const props = input();
  const { result } = renderHook(() => usePrimarySavingsRecovery(props));
  await waitFor(() => expect(result.current.error).toBe(true));
  expect(result.current.ready).toBe(false);
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.ready).toBe(true));
});
it('ignores a previous goal response after switching goals', async () => {
  const props = input();
  let resolveOld!: (value: unknown) => void;
  mockRecover
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        })
    )
    .mockResolvedValueOnce(null);
  const { result, rerender } = renderHook(
    (goalId: string) => usePrimarySavingsRecovery({ ...props, goalId }),
    { initialProps: 'goal-1' }
  );
  rerender('goal-2');
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(async () =>
    resolveOld({ operationId: 'old-operation', amountKobo: 100 })
  );
  expect(props.operationRef.current).toBeNull();
  expect(props.setAmount).not.toHaveBeenCalled();
});
it('allows legacy contribution when savings is off and no operation is bound', async () => {
  mockRecover.mockRejectedValue(
    Object.assign(new Error('unavailable'), { code: 'SAVINGS_NOT_READY' })
  );
  const props = input();
  const { result } = renderHook(() => usePrimarySavingsRecovery(props));
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.error).toBe(false);
  expect(props.operationRef.current).toBeNull();
});
it('keeps blocking when savings is unreachable while an operation is bound', async () => {
  const props = input();
  mockRecover.mockImplementationOnce(async () => {
    props.operationRef.current = 'existing-operation';
    throw Object.assign(new Error('unavailable'), {
      code: 'SAVINGS_NOT_READY',
    });
  });
  const { result } = renderHook(() => usePrimarySavingsRecovery(props));
  await waitFor(() => expect(result.current.error).toBe(true));
  expect(result.current.ready).toBe(false);
  expect(props.operationRef.current).toBe('existing-operation');
});
it('stays ready without recovering when the server reports unconfigured', async () => {
  mockUseCapability.mockReturnValue(false);
  const props = input();
  const { result } = renderHook(() => usePrimarySavingsRecovery(props));
  expect(result.current.ready).toBe(true);
  expect(result.current.error).toBe(false);
  await act(async () => {
    await Promise.resolve();
  });
  expect(mockRecover).not.toHaveBeenCalled();
  expect(props.setAmount).not.toHaveBeenCalled();
});
