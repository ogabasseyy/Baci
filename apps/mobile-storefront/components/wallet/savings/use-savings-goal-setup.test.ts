import { act, renderHook } from '@testing-library/react-native';
import {
  retrySavingsGoalSetup,
  setupExistingSavingsGoal,
} from '@/lib/customer-savings';
import { useSavingsGoalSetup } from './use-savings-goal-setup';

jest.mock('@/lib/customer-savings', () => ({
  setupExistingSavingsGoal: jest.fn(),
  retrySavingsGoalSetup: jest.fn(),
}));

const setup = jest.mocked(setupExistingSavingsGoal);
const retry = jest.mocked(retrySavingsGoalSetup);
const render = (onSettled = jest.fn()) => ({
  onSettled,
  ...renderHook(() =>
    useSavingsGoalSetup({ goalId: 'goal-1', merchantId: 'm-1', onSettled })
  ),
});

beforeEach(() => {
  jest.clearAllMocks();
  setup.mockResolvedValue({ status: 'pending' } as never);
  retry.mockResolvedValue({ status: 'pending' } as never);
});

describe('useSavingsGoalSetup', () => {
  it('sends nothing until the customer has chosen', async () => {
    const { result, onSettled } = render();
    await act(async () => {
      await result.current.submit();
    });
    expect(setup).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
    expect(result.current.choice).toBeNull();
  });

  it.each([
    true,
    false,
  ])('sends exactly the chosen answer (%s), then re-reads status', async (answer) => {
    const { result, onSettled } = render();
    act(() => result.current.setChoice(answer));
    await act(async () => {
      await result.current.submit();
    });
    expect(setup).toHaveBeenCalledTimes(1);
    expect(setup).toHaveBeenCalledWith({
      goalId: 'goal-1',
      merchantId: 'm-1',
      interestAccepted: answer,
    });
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });

  it('ignores a second press while the first is in flight', async () => {
    let finish: () => void = () => {};
    setup.mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve({ status: 'pending' } as never);
      })
    );
    const { result } = render();
    act(() => result.current.setChoice(true));
    let first: Promise<unknown> = Promise.resolve();
    act(() => {
      first = result.current.submit();
    });
    await act(async () => {
      await result.current.submit();
    });
    expect(setup).toHaveBeenCalledTimes(1);
    expect(result.current.submitting).toBe(true);
    await act(async () => {
      finish();
      await first;
    });
    expect(result.current.submitting).toBe(false);
  });

  it('treats a failure as indeterminate: no retry, status re-read, safe message', async () => {
    setup.mockRejectedValue(new Error('private provider detail'));
    const { result, onSettled } = render();
    act(() => result.current.setChoice(false));
    await act(async () => {
      await result.current.submit();
    });
    expect(setup).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(result.current.error).not.toContain('private');
    expect(result.current.attempted).toBe(true);
  });
});

describe('useSavingsGoalSetup retry', () => {
  it('re-runs setup without any interest answer, then re-reads status', async () => {
    const { result, onSettled } = render();
    await act(async () => {
      await result.current.retry();
    });
    expect(setup).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledWith({ goalId: 'goal-1', merchantId: 'm-1' });
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(result.current.attempted).toBe(true);
  });

  it('ignores a second press while a retry is in flight', async () => {
    let finish: () => void = () => {};
    retry.mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve({ status: 'pending' } as never);
      })
    );
    const { result } = render();
    let first: Promise<unknown> = Promise.resolve();
    act(() => {
      first = result.current.retry();
    });
    await act(async () => {
      await result.current.retry();
    });
    expect(retry).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish();
      await first;
    });
  });

  it('treats a failed retry as indeterminate: safe message, status re-read', async () => {
    retry.mockRejectedValue(new Error('private provider detail'));
    const { result, onSettled } = render();
    await act(async () => {
      await result.current.retry();
    });
    expect(retry).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(result.current.error).not.toContain('private');
  });
});
