import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import type { QuizEvent } from '@/services/quiz-types';
import { useQuizWaitingRoom } from './use-quiz-waiting-room';

const event = (overrides: Partial<QuizEvent> = {}): QuizEvent => ({
  endsAt: '2026-08-23T12:10:00.000Z',
  id: 'event-1',
  prizeName: 'Phone',
  questionCount: 10,
  startsAt: '2026-08-23T12:00:00.000Z',
  status: 'scheduled',
  title: 'Noon Quiz',
  serverNow: '2026-08-23T11:59:00.000Z',
  timePerQuestionSeconds: 10,
  ...overrides,
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('useQuizWaitingRoom', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses server offset for countdown and never starts from local time alone', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-23T12:00:30.000Z'));
    const refresh = jest.fn(async () => [event({ status: 'scheduled' })]);
    const onStart = jest.fn();
    const { result } = renderHook(() =>
      useQuizWaitingRoom({
        event: event(),
        onExit: jest.fn(),
        onStart,
        refresh,
      })
    );

    expect(result.current.remainingSeconds).toBe(60);
    await act(async () => {
      jest.advanceTimersByTime(61_000);
      await Promise.resolve();
    });
    expect(onStart).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it('starts once after refreshed event becomes active', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-23T11:59:59.000Z'));
    const refresh = jest
      .fn<() => Promise<QuizEvent[]>>()
      .mockResolvedValueOnce([
        event({
          serverNow: '2026-08-23T11:59:59.000Z',
          startsAt: '2026-08-23T12:00:00.000Z',
          status: 'active',
        }),
      ]);
    const onStart = jest.fn();
    const onEventsUpdated = jest.fn();
    const { result } = renderHook(() =>
      useQuizWaitingRoom({
        event: event({ serverNow: '2026-08-23T11:59:59.000Z' }),
        onEventsUpdated,
        onExit: jest.fn(),
        onStart,
        refresh,
      })
    );
    const listener = jest
      .mocked(AppState.addEventListener)
      .mock.calls.at(-1)?.[1] as (state: 'active') => void;

    await act(async () => {
      listener('active');
      await Promise.resolve();
    });
    await act(async () => {
      jest.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    expect(onStart).toHaveBeenCalledWith('event-1', true);
    expect(onEventsUpdated).toHaveBeenCalledWith([
      expect.objectContaining({ status: 'active' }),
    ]);
    expect(onEventsUpdated.mock.invocationCallOrder[0]).toBeLessThan(
      onStart.mock.invocationCallOrder[0]
    );
    expect(result.current.event.status).toBe('active');
    await act(async () => {
      jest.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('refreshes on foreground and exits when event is terminal', async () => {
    const refresh = jest
      .fn<() => Promise<QuizEvent[]>>()
      .mockResolvedValue([event({ status: 'cancelled' })]);
    const onExit = jest.fn();
    renderHook(() =>
      useQuizWaitingRoom({
        event: event(),
        onExit,
        onStart: jest.fn(),
        refresh,
      })
    );
    const listener = jest
      .mocked(AppState.addEventListener)
      .mock.calls.at(-1)?.[1];
    expect(listener).toEqual(expect.any(Function));
    await act(async () => {
      (listener as (state: 'active') => void)('active');
      await Promise.resolve();
    });
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('does not start an active response that resolves after backgrounding', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-23T11:59:59.000Z'));
    const first = createDeferred<QuizEvent[]>();
    const second = createDeferred<QuizEvent[]>();
    const refresh = jest
      .fn<() => Promise<QuizEvent[]>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const onStart = jest.fn();
    renderHook(() =>
      useQuizWaitingRoom({
        event: event({ serverNow: '2026-08-23T11:59:59.000Z' }),
        onExit: jest.fn(),
        onStart,
        refresh,
      })
    );
    const listener = jest
      .mocked(AppState.addEventListener)
      .mock.calls.at(-1)?.[1] as (state: 'active' | 'background') => void;

    await act(async () => {
      jest.advanceTimersByTime(2_000);
      listener('background');
      first.resolve([event({ status: 'active' })]);
      await Promise.resolve();
    });
    expect(onStart).not.toHaveBeenCalled();

    await act(async () => {
      listener('active');
      second.resolve([event({ status: 'active' })]);
      await Promise.resolve();
    });
    expect(onStart).toHaveBeenCalledWith('event-1', true);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('ignores stale R1 when R1 resolves after foreground starts R2', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-23T11:59:59.000Z'));
    const first = createDeferred<QuizEvent[]>();
    const second = createDeferred<QuizEvent[]>();
    const refresh = jest
      .fn<() => Promise<QuizEvent[]>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const onStart = jest.fn();
    renderHook(() =>
      useQuizWaitingRoom({
        event: event({ serverNow: '2026-08-23T11:59:59.000Z' }),
        onExit: jest.fn(),
        onStart,
        refresh,
      })
    );
    const listener = jest
      .mocked(AppState.addEventListener)
      .mock.calls.at(-1)?.[1] as (state: 'active' | 'background') => void;

    await act(async () => {
      jest.advanceTimersByTime(2_000);
      listener('background');
      listener('active');
      await Promise.resolve();
    });
    expect(refresh).toHaveBeenCalledTimes(2);

    await act(async () => {
      first.resolve([event({ status: 'active' })]);
      await Promise.resolve();
    });
    expect(onStart).not.toHaveBeenCalled();

    await act(async () => {
      second.resolve([event({ status: 'active' })]);
      await Promise.resolve();
    });
    expect(onStart).toHaveBeenCalledWith('event-1', true);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending active response when the waiting room unmounts', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-23T11:59:59.000Z'));
    const deferred = createDeferred<QuizEvent[]>();
    const onStart = jest.fn();
    const { unmount } = renderHook(() =>
      useQuizWaitingRoom({
        event: event({ serverNow: '2026-08-23T11:59:59.000Z' }),
        onExit: jest.fn(),
        onStart,
        refresh: jest.fn(() => deferred.promise),
      })
    );
    await act(async () => {
      jest.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    unmount();
    await act(async () => {
      deferred.resolve([event({ status: 'active' })]);
      await Promise.resolve();
    });
    expect(onStart).not.toHaveBeenCalled();
  });
});
