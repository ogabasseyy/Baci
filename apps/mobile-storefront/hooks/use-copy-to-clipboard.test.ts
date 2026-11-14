import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { setClipboardString } from '@/lib/clipboard';
import { useCopyToClipboard } from './use-copy-to-clipboard';

const mockTriggerHaptic = jest.fn();

jest.mock('@/lib/clipboard', () => ({
  setClipboardString: jest.fn(),
}));

jest.mock('@/hooks/use-haptics', () => ({
  triggerHaptic: (...args: unknown[]) => mockTriggerHaptic(...args),
}));

const mockSetClipboardString = jest.mocked(setClipboardString);

describe('useCopyToClipboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetClipboardString.mockResolvedValue(true);
  });

  it('copies text, triggers success feedback, and clears feedback after timeout', async () => {
    jest.useFakeTimers();
    try {
      const { result } = renderHook(() => useCopyToClipboard());

      await act(async () => {
        await result.current.copyToClipboard('1234567890');
      });

      expect(mockSetClipboardString).toHaveBeenCalledWith('1234567890');
      expect(mockTriggerHaptic).toHaveBeenCalledWith('success');
      expect(result.current.feedback).toBe(
        'Account number copied to clipboard.'
      );

      act(() => {
        jest.advanceTimersByTime(3000);
      });

      expect(result.current.feedback).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows failure feedback without success haptics when native copy fails', async () => {
    mockSetClipboardString.mockResolvedValue(false);
    const { result } = renderHook(() => useCopyToClipboard());

    await act(async () => {
      await result.current.copyToClipboard('1234567890');
    });

    expect(mockTriggerHaptic).not.toHaveBeenCalled();
    expect(result.current.feedback).toBe('Could not copy account number.');
  });

  it('clears feedback on demand', async () => {
    const { result } = renderHook(() => useCopyToClipboard());

    await act(async () => {
      await result.current.copyToClipboard('1234567890');
    });
    act(() => {
      result.current.clearFeedback();
    });

    expect(result.current.feedback).toBeNull();
  });

  it('uses caller-provided feedback messages', async () => {
    const { result } = renderHook(() =>
      useCopyToClipboard({
        failureMessage: 'Copy failed.',
        successMessage: 'Copied device savings account.',
      })
    );

    await act(async () => {
      await result.current.copyToClipboard('1234567890');
    });

    expect(result.current.feedback).toBe('Copied device savings account.');
  });

  it('does not update state or trigger haptics after unmount', async () => {
    let resolveClipboard: (copied: boolean) => void = () => undefined;
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockSetClipboardString.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveClipboard = resolve;
      })
    );

    try {
      const { result, unmount } = renderHook(() => useCopyToClipboard());
      const copyPromise = result.current.copyToClipboard('1234567890');

      unmount();

      await act(async () => {
        resolveClipboard(true);
        await copyPromise;
        await Promise.resolve();
      });

      expect(mockTriggerHaptic).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});

describe('bugfix: copy gives no feedback after a dev double-mount', () => {
  it('still shows feedback when the hook was mounted twice (StrictMode)', async () => {
    // Arrange: StrictMode runs the mount effect, its cleanup, then again.
    const { StrictMode } = jest.requireActual<typeof import('react')>('react');
    mockSetClipboardString.mockResolvedValue(true);
    const { result } = renderHook(() => useCopyToClipboard(), {
      wrapper: StrictMode,
    });

    // Act
    await act(async () => {
      await result.current.copyToClipboard('3685660013');
    });

    // Assert
    expect(result.current.feedback).toBe('Account number copied to clipboard.');
  });
});
