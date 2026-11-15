import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react-native';
import { fetchQuizEvents } from '@/services/quiz';
import { useQuizTriesLeft } from './use-quiz-tries-left';

jest.mock('@/services/quiz', () => ({ fetchQuizEvents: jest.fn() }));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn() }),
}));

const mockFetch = jest.mocked(fetchQuizEvents);
const event = (attemptsUsed?: number) => ({
  attemptsUsed,
  endsAt: null,
  id: 'event-1',
  maxAttempts: 3,
  prizeName: 'Phone',
  questionCount: 3,
  startsAt: null,
  status: 'active' as const,
  title: 'Quiz',
});

describe('useQuizTriesLeft', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('reads the count from a fresh fetch, not the cached lobby list', async () => {
    mockFetch.mockResolvedValue([event(2)]);
    const { result } = renderHook(() => useQuizTriesLeft('event-1', true));
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe(1));
    expect(mockFetch).toHaveBeenCalledWith({ stopAtEventId: 'event-1' });
  });

  it('stays null when the server sends no count', async () => {
    mockFetch.mockResolvedValue([event(undefined)]);
    const { result } = renderHook(() => useQuizTriesLeft('event-1', true));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it('stays null when the fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useQuizTriesLeft('event-1', true));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it('does not fetch when another attempt is not allowed', () => {
    const { result } = renderHook(() => useQuizTriesLeft('event-1', false));
    expect(result.current).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('uses the fresh maxAttempts even when the cached event is unavailable', async () => {
    mockFetch.mockResolvedValue([{ ...event(0), maxAttempts: 5 }]);
    const { result } = renderHook(() => useQuizTriesLeft('event-1', true));
    await waitFor(() => expect(result.current).toBe(5));
  });
});
