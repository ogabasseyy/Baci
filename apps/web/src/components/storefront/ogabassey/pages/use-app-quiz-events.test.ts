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
    const { result } = renderHook(() => useAppQuizEvents('ogabassey', false));

    expect(result.current).toEqual([]);
    expect(fetchAppQuizEvents).not.toHaveBeenCalled();
  });

  it('returns the app quiz events once enabled', async () => {
    const event = appQuizEvent();
    vi.mocked(fetchAppQuizEvents).mockResolvedValue([event]);

    const { result } = renderHook(() => useAppQuizEvents('ogabassey', true));

    await waitFor(() => expect(result.current).toEqual([event]));
    expect(fetchAppQuizEvents).toHaveBeenCalledWith('ogabassey');
  });

  it('degrades to no events when the listing fails', async () => {
    vi.mocked(fetchAppQuizEvents).mockImplementation(() =>
      Promise.reject(new Error('offline'))
    );

    const { result } = renderHook(() => useAppQuizEvents('ogabassey', true));

    await waitFor(() => expect(fetchAppQuizEvents).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });
});
