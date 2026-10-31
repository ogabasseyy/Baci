import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appQuizEvent } from './app-quiz-event.test-support';
import { fetchAppQuizEvents } from './fetch-app-quiz-events';
import { useAppQuizEvents } from './use-app-quiz-events';

vi.mock('./fetch-app-quiz-events', () => ({ fetchAppQuizEvents: vi.fn() }));

beforeEach(() => {
  vi.mocked(fetchAppQuizEvents).mockReset();
});

describe('useAppQuizEvents', () => {
  it('does not fetch while the shopper is signed out', () => {
    const { result } = renderHook(() => useAppQuizEvents('ogabassey', null));

    expect(result.current).toEqual({ events: [], settled: true });
    expect(fetchAppQuizEvents).not.toHaveBeenCalled();
  });

  it('returns the app quiz events for the signed-in user', async () => {
    const event = appQuizEvent();
    vi.mocked(fetchAppQuizEvents).mockResolvedValue([event]);

    const { result } = renderHook(() => useAppQuizEvents('ogabassey', 'user-a'));

    expect(result.current.settled).toBe(false);
    await waitFor(() =>
      expect(result.current).toEqual({ events: [event], settled: true })
    );
    expect(fetchAppQuizEvents).toHaveBeenCalledWith('ogabassey');
  });

  it('degrades to no events when the listing fails', async () => {
    vi.mocked(fetchAppQuizEvents).mockImplementation(() =>
      Promise.reject(new Error('offline'))
    );

    const { result } = renderHook(() => useAppQuizEvents('ogabassey', 'user-a'));

    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.events).toEqual([]);
  });

  describe('bugfix: previous account events leaked after an account switch', () => {
    it('shows nothing for the new user until their own lookup completes', async () => {
      const privateEvent = appQuizEvent({ title: 'Private test quiz' });
      let resolveSecond: (events: never[]) => void = () => undefined;
      vi.mocked(fetchAppQuizEvents)
        .mockResolvedValueOnce([privateEvent])
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveSecond = resolve;
            })
        );

      const { result, rerender } = renderHook(
        ({ userId }) => useAppQuizEvents('ogabassey', userId),
        { initialProps: { userId: 'user-a' as string | null } }
      );
      await waitFor(() => expect(result.current.events).toEqual([privateEvent]));

      rerender({ userId: 'user-b' });

      expect(result.current).toEqual({ events: [], settled: false });
      expect(fetchAppQuizEvents).toHaveBeenCalledTimes(2);
      resolveSecond([]);
      await waitFor(() =>
        expect(result.current).toEqual({ events: [], settled: true })
      );
    });

    it('drops the events on sign-out', async () => {
      vi.mocked(fetchAppQuizEvents).mockResolvedValue([appQuizEvent()]);
      const { result, rerender } = renderHook(
        ({ userId }) => useAppQuizEvents('ogabassey', userId),
        { initialProps: { userId: 'user-a' as string | null } }
      );
      await waitFor(() => expect(result.current.events).toHaveLength(1));

      rerender({ userId: null });

      expect(result.current).toEqual({ events: [], settled: true });
    });
  });
});
