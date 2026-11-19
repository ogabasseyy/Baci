import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { useReduceMotion } from './use-reduce-motion';

describe('useReduceMotion', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps motion safe and unresolved until the device preference is known', () => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockReturnValue(new Promise(() => undefined));
    const { result } = renderHook(() => useReduceMotion());
    expect(result.current).toBeNull();
  });

  it('turns on when the device asks for reduced motion', async () => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    const { result } = renderHook(() => useReduceMotion());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('fails safe to reduced motion when the preference query rejects', async () => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockRejectedValue(new Error('unavailable'));
    const { result } = renderHook(() => useReduceMotion());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('keeps a newer preference event when the initial query resolves late', async () => {
    let resolveInitialQuery: ((enabled: boolean) => void) | undefined;
    const eventListener = jest.fn();
    const remove = jest.fn();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveInitialQuery = resolve;
      })
    );
    jest
      .spyOn(AccessibilityInfo, 'addEventListener')
      .mockImplementation((_event, listener) => {
        eventListener.mockImplementation(listener);
        return { remove };
      });

    const { result } = renderHook(() => useReduceMotion());
    await act(async () => {
      eventListener(true);
    });
    await waitFor(() => expect(result.current).toBe(true));
    await act(async () => {
      resolveInitialQuery?.(false);
    });
    expect(result.current).toBe(true);
  });

  it('keeps an allowed-motion event when the initial query rejects late', async () => {
    let rejectInitialQuery: ((error: Error) => void) | undefined;
    const eventListener = jest.fn();
    const remove = jest.fn();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(
      new Promise<boolean>((_resolve, reject) => {
        rejectInitialQuery = reject;
      })
    );
    jest
      .spyOn(AccessibilityInfo, 'addEventListener')
      .mockImplementation((_event, listener) => {
        eventListener.mockImplementation(listener);
        return { remove };
      });

    const { result } = renderHook(() => useReduceMotion());
    await act(async () => {
      eventListener(false);
    });
    await waitFor(() => expect(result.current).toBe(false));
    await act(async () => {
      rejectInitialQuery?.(new Error('stale query failure'));
      await Promise.resolve();
    });
    expect(result.current).toBe(false);
  });
});

it('enables animation only after the device explicitly allows motion', async () => {
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(false);
  const { result } = renderHook(() => useReduceMotion());
  await waitFor(() => expect(result.current).toBe(false));
});
