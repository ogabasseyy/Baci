import { act, renderHook } from '@testing-library/react-native';
import {
  checkGoalActionStatus,
  issueGoalAction,
  submitGoalAction,
} from '@/lib/goal-lifecycle-api';
import { useAuthStore } from '@/stores/auth-store';
import { useGoalLifecycle } from './use-goal-lifecycle';
import { useWalletPinPrompt } from './use-wallet-pin-prompt';

export const MERCHANT = '11111111-1111-4111-8111-111111111111';
export const GOAL = '22222222-2222-4222-8222-222222222222';
export const OP = '33333333-3333-4333-8333-333333333333';
export const PROOF = 'c'.repeat(64);
export const fail = (
  code: string | undefined,
  message = `server says ${code}`
) => Object.assign(new Error(message), code ? { code } : {});

export const requestProof = jest.fn();
export const takeInvalid = jest.fn();
export const cancelPrompt = jest.fn();
export const issue = jest.mocked(issueGoalAction);
export const submit = jest.mocked(submitGoalAction);
export const status = jest.mocked(checkGoalActionStatus);

export function setup(kind: 'cancel' | 'complete' = 'cancel') {
  return renderHook(() => useGoalLifecycle({ kind, goalId: GOAL }));
}
// Runs an action without waiting for it to finish: polling only ends when the
// fake clock is advanced.
export async function run(action: () => Promise<void>) {
  await act(async () => {
    void action();
    await jest.advanceTimersByTimeAsync(0);
  });
}
export async function start(result: {
  current: ReturnType<typeof useGoalLifecycle>;
}) {
  await run(() => result.current.begin());
}

/** Fake timers, reset mocks and a signed-in user: call from a test file. */
export function installLifecycleHarness() {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetAllMocks();
    takeInvalid.mockReturnValue(null);
    jest.mocked(useWalletPinPrompt).mockReturnValue({
      requestProof,
      takeInvalid,
      cancel: cancelPrompt,
      sheetProps: { request: null, onProof: jest.fn(), onCancel: jest.fn() },
    });
    act(() => {
      useAuthStore.setState({
        user: { id: 'user-a' } as never,
        merchantId: MERCHANT,
      });
    });
  });
  afterEach(() => jest.useRealTimers());
}
