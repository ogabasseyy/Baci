import { act, renderHook } from '@testing-library/react-native';
import { issueGoalAction } from '@/lib/goal-lifecycle-api';
import { useAuthStore } from '@/stores/auth-store';
import {
  SERVER_OFF_GOAL_ID,
  SERVER_OFF_MERCHANT_ID,
  serverOffError,
} from '@/test-support/piggyvest-server-off.test-support';
import { useGoalLifecycle } from './use-goal-lifecycle';

jest.mock('@/lib/goal-lifecycle-api');

describe('server keeps PiggyVest off', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    act(() => {
      useAuthStore.setState({
        user: { id: 'user-a' } as never,
        merchantId: SERVER_OFF_MERCHANT_ID,
      });
    });
  });

  it('sends nothing until the customer presses Continue', () => {
    const { result } = renderHook(() =>
      useGoalLifecycle({ kind: 'cancel', goalId: SERVER_OFF_GOAL_ID })
    );
    expect(result.current.step).toBe('review');
    expect(issueGoalAction).not.toHaveBeenCalled();
  });

  it('a not-ready refusal shows its server text with no retry and no PIN', async () => {
    jest
      .mocked(issueGoalAction)
      .mockRejectedValue(serverOffError('SAVINGS_NOT_READY'));
    const { result } = renderHook(() =>
      useGoalLifecycle({ kind: 'cancel', goalId: SERVER_OFF_GOAL_ID })
    );
    await act(async () => {
      await result.current.begin();
    });
    expect(result.current.step).toBe('failed');
    expect(result.current.message).toBe('not ready');
    expect(result.current.canStartAgain).toBe(false);
  });

  it('an app-update refusal shows the server text with no retry', async () => {
    jest
      .mocked(issueGoalAction)
      .mockRejectedValue(serverOffError('APP_UPDATE_REQUIRED'));
    const { result } = renderHook(() =>
      useGoalLifecycle({ kind: 'cancel', goalId: SERVER_OFF_GOAL_ID })
    );
    await act(async () => {
      await result.current.begin();
    });
    expect(result.current.step).toBe('failed');
    expect(result.current.message).toBe('not ready');
    expect(result.current.canStartAgain).toBe(false);
  });

  it('a plan that was never set up shows the server text with no retry', async () => {
    jest
      .mocked(issueGoalAction)
      .mockRejectedValue(serverOffError('GOAL_NOT_SET_UP'));
    const { result } = renderHook(() =>
      useGoalLifecycle({ kind: 'cancel', goalId: SERVER_OFF_GOAL_ID })
    );
    await act(async () => {
      await result.current.begin();
    });
    expect(result.current.step).toBe('failed');
    expect(result.current.message).toBe('not ready');
    expect(result.current.canStartAgain).toBe(false);
  });
});
