import { act, renderHook } from '@testing-library/react-native';
import {
  AUTO_SETUP_RETRIES,
  resetAutoSetupRetries,
  useAutoRetrySetup,
} from './use-auto-retry-setup';

type Props = { active: boolean; submitting: boolean; scopeKey: string };

function setup(initial: Props) {
  const retry = jest.fn().mockResolvedValue(true);
  const hook = renderHook(
    (props: Props) => useAutoRetrySetup({ ...props, retry }),
    {
      initialProps: initial,
    }
  );
  return { ...hook, retry };
}

beforeEach(() => resetAutoSetupRetries());

describe('useAutoRetrySetup with PiggyVest off', () => {
  describe('bugfix: reopening the sheet refilled the automatic tries', () => {
    it('keeps the tries spent on a goal after the screen closes and reopens', async () => {
      const first = setup({ active: true, submitting: false, scopeKey: 'a' });
      await act(async () => {});
      first.rerender({ active: true, submitting: true, scopeKey: 'a' });
      // The caller re-reads status (leaving the retryable phase).
      first.rerender({ active: false, submitting: false, scopeKey: 'a' });
      first.rerender({ active: true, submitting: false, scopeKey: 'a' });
      await act(async () => {});
      expect(first.retry).toHaveBeenCalledTimes(AUTO_SETUP_RETRIES);
      first.unmount();

      const reopened = setup({
        active: true,
        submitting: false,
        scopeKey: 'a',
      });
      await act(async () => {});
      expect(reopened.retry).not.toHaveBeenCalled();
      expect(reopened.result.current.exhausted).toBe(true);
    });
  });

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
        // The caller re-reads status (leaving the retryable phase).
        rerender({ active: false, submitting: false, scopeKey: 'a' });
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

  describe('bugfix: a deduped retry used up an automatic try', () => {
    it('gives the try back when the setup hook did not send', async () => {
      const retry = jest.fn().mockResolvedValue(false);
      const { result } = renderHook(() =>
        useAutoRetrySetup({
          active: true,
          submitting: true,
          scopeKey: 'a',
          retry,
        })
      );
      expect(retry).not.toHaveBeenCalled();
      expect(result.current.exhausted).toBe(false);
      const second = renderHook(
        ({ submitting }: { submitting: boolean }) =>
          useAutoRetrySetup({ active: true, submitting, scopeKey: 'b', retry }),
        { initialProps: { submitting: false } }
      );
      await act(async () => {});
      second.rerender({ submitting: true });
      second.rerender({ submitting: false });
      await act(async () => {});
      expect(second.result.current.exhausted).toBe(false);
    });
  });

  it('gives the try back when the retry throws before sending', async () => {
    const retry = jest.fn().mockRejectedValue(new Error('offline'));
    const { result, rerender } = renderHook(
      ({ submitting }: { submitting: boolean }) =>
        useAutoRetrySetup({ active: true, submitting, scopeKey: 'c', retry }),
      { initialProps: { submitting: false } }
    );
    await act(async () => {});
    rerender({ submitting: true });
    rerender({ submitting: false });
    await act(async () => {});
    expect(result.current.exhausted).toBe(false);
  });
});

describe('bugfix: the retry counter grew without limit', () => {
  it('forgets the oldest goal after 64, so its tries start over', async () => {
    const first = setup({ active: true, submitting: false, scopeKey: 'g0' });
    await act(async () => {});
    first.rerender({ active: true, submitting: true, scopeKey: 'g0' });
    // The caller re-reads status (leaving the retryable phase).
    first.rerender({ active: false, submitting: false, scopeKey: 'g0' });
    first.rerender({ active: true, submitting: false, scopeKey: 'g0' });
    await act(async () => {});
    expect(first.result.current.exhausted).toBe(true);
    first.unmount();
    for (let n = 1; n <= 64; n += 1) {
      const other = setup({
        active: true,
        submitting: false,
        scopeKey: `g${n}`,
      });
      await act(async () => {});
      other.unmount();
    }
    const again = setup({ active: false, submitting: false, scopeKey: 'g0' });
    expect(again.result.current.exhausted).toBe(false);
  });
});

describe('bugfix: both automatic tries could be spent back to back', () => {
  it('waits for a fresh stalled reading before the next try', async () => {
    // Arrange: the first try is sent.
    const { retry, rerender, result } = setup({
      active: true,
      submitting: false,
      scopeKey: 'r',
    });
    await act(async () => {});

    // Act: the send settles, but status has not been read again yet.
    rerender({ active: true, submitting: true, scopeKey: 'r' });
    rerender({ active: true, submitting: false, scopeKey: 'r' });
    await act(async () => {});

    // Assert: the second try is still left until a new reading arrives.
    expect(retry).toHaveBeenCalledTimes(1);
    expect(result.current.exhausted).toBe(false);
    rerender({ active: false, submitting: false, scopeKey: 'r' });
    rerender({ active: true, submitting: false, scopeKey: 'r' });
    await act(async () => {});
    expect(retry).toHaveBeenCalledTimes(2);
  });
});
