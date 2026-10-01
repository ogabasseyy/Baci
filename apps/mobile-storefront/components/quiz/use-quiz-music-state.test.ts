import { renderHook } from '@testing-library/react-native';
import { useQuizMusicState } from './use-quiz-music-state';

describe('useQuizMusicState', () => {
  it('plays during an active question and formats the event countdown', () => {
    const now = new Date('2026-08-13T12:00:00.000Z');
    jest.spyOn(Date, 'now').mockReturnValue(now.getTime());
    const { result } = renderHook(() =>
      useQuizMusicState({
        eventEndsAt: '2026-08-13T12:01:00.000Z',
        hasActiveAttempt: true,
        lifecycle: 'in_progress',
        serverNow: now.toISOString(),
        status: 'question',
      })
    );
    expect(result.current).toEqual({ gameEndsIn: '1:00', shouldPlay: true });
  });

  it('stays silent in the lobby', () => {
    const { result } = renderHook(() =>
      useQuizMusicState({
        hasActiveAttempt: false,
        lifecycle: 'idle',
        status: 'ready',
      })
    );
    expect(result.current.shouldPlay).toBe(false);
  });
});
