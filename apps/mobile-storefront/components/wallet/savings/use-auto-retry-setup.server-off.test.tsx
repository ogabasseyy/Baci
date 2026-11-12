import { act, renderHook } from '@testing-library/react-native';
import { AUTO_SETUP_RETRIES, useAutoRetrySetup } from './use-auto-retry-setup';

type Props = { active: boolean; submitting: boolean; scopeKey: string };

function setup(initial: Props) {
  const retry = jest.fn().mockResolvedValue(undefined);
  const hook = renderHook(
    (props: Props) => useAutoRetrySetup({ ...props, retry }),
    {
      initialProps: initial,
    }
  );
  return { ...hook, retry };
}

describe('useAutoRetrySetup with PiggyVest off', () => {
  it('does nothing while setup is not retryable', () => {
    const { retry, result } = setup({
      active: false,
      submitting: false,
      scopeKey: 'a',
    });
    expect(retry).not.toHaveBeenCalled();
    expect(result.current.exhausted).toBe(false);
  });

  describe('bugfix: a stalled setup waited for the customer to press a button', () => {
    it('retries by itself, then hands over after the allowed tries', async () => {
      const { retry, rerender, result } = setup({
        active: true,
        submitting: false,
        scopeKey: 'a',
      });
      await act(async () => {});
      expect(retry).toHaveBeenCalledTimes(1);
      for (let attempt = 1; attempt < AUTO_SETUP_RETRIES + 1; attempt += 1) {
        rerender({ active: true, submitting: true, scopeKey: 'a' });
        rerender({ active: true, submitting: false, scopeKey: 'a' });
        await act(async () => {});
      }
      expect(retry).toHaveBeenCalledTimes(AUTO_SETUP_RETRIES);
      expect(result.current.exhausted).toBe(true);
    });
  });

  it('starts over for another goal', async () => {
    const { retry, rerender } = setup({
      active: true,
      submitting: false,
      scopeKey: 'a',
    });
    await act(async () => {});
    rerender({ active: true, submitting: false, scopeKey: 'b' });
    await act(async () => {});
    expect(retry).toHaveBeenCalledTimes(2);
  });
});
