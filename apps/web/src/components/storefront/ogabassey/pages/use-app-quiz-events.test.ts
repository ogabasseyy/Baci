import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appQuizEvent } from './app-quiz-event.test-support';
import { fetchAppQuizEvents } from './fetch-app-quiz-events';
import { useAppQuizEvents } from './use-app-quiz-events';

vi.mock('./fetch-app-quiz-events', () => ({ fetchAppQuizEvents: vi.fn() }));

beforeEach(() => {
  vi.mocked(fetchAppQuizEvents).mockReset();
});

describe('useAppQuizEvents', () => {
  it('is idle and does not fetch while the shopper is signed out', () => {
    const { result } = renderHook(() => useAppQuizEvents('ogabassey', null));

    expect(result.current.status).toBe('idle');
    expect(result.current.events).toEqual([]);
    expect(fetchAppQuizEvents).not.toHaveBeenCalled();
  });

  it('reports loading, then the events for the signed-in user', async () => {
    const event = appQuizEvent();
    vi.mocked(fetchAppQuizEvents).mockResolvedValue([event]);

    const { result } = renderHook(() =>
      useAppQuizEvents('ogabassey', 'user-a')
    );

    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.events).toEqual([event]);
    expect(fetchAppQuizEvents).toHaveBeenCalledWith('ogabassey');
  });

  describe('bugfix: a failed listing looked like no quizzes', () => {
    it('reports error instead of an empty successful listing', async () => {
      vi.mocked(fetchAppQuizEvents).mockImplementation(() =>
        Promise.reject(new Error('offline'))
      );

      const { result } = renderHook(() =>
        useAppQuizEvents('ogabassey', 'user-a')
      );

      await waitFor(() => expect(result.current.status).toBe('error'));
      expect(result.current.events).toEqual([]);
    });

    it('retries the listing and recovers', async () => {
      const event = appQuizEvent();
      vi.mocked(fetchAppQuizEvents)
        .mockImplementationOnce(() => Promise.reject(new Error('offline')))
        .mockResolvedValueOnce([event]);
      const { result } = renderHook(() =>
        useAppQuizEvents('ogabassey', 'user-a')
      );
      await waitFor(() => expect(result.current.status).toBe('error'));

      act(() => result.current.retry());

      expect(result.current.status).toBe('loading');
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.events).toEqual([event]);
      expect(fetchAppQuizEvents).toHaveBeenCalledTimes(2);
    });
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

      expect(result.current.events).toEqual([]);
      expect(result.current.status).toBe('loading');
      resolveSecond([]);
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.events).toEqual([]);
    });

    it('drops the events on sign-out', async () => {
      vi.mocked(fetchAppQuizEvents).mockResolvedValue([appQuizEvent()]);
      const { result, rerender } = renderHook(
        ({ userId }) => useAppQuizEvents('ogabassey', userId),
        { initialProps: { userId: 'user-a' as string | null } }
      );
      await waitFor(() => expect(result.current.events).toHaveLength(1));

      rerender({ userId: null });

      expect(result.current.events).toEqual([]);
      expect(result.current.status).toBe('idle');
    });
  });
});
