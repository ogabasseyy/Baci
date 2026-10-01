import { act, renderHook, waitFor } from '@testing-library/react-native';
import { fetchQuizResult } from '@/services/quiz-results';
import type { QuizV2Result } from '@/services/quiz-types';
import { useQuizFinalResultRefresh } from './useQuizFinalResultRefresh';

let mockFocused = false;

jest.mock('expo-router', () => ({
  useIsFocused: jest.fn(() => mockFocused),
}));
jest.mock('@/services/quiz-results', () => ({
  fetchQuizResult: jest.fn(),
}));

const finalResult: QuizV2Result = {
  attemptId: 'attempt-1',
  availability: 'final',
  availableAt: '2026-08-17T10:00:00.000Z',
  rank: 1,
  score: 10,
  totalQuestions: 10,
};

describe('useQuizFinalResultRefresh', () => {
  afterEach(() => {
    mockFocused = false;
    jest.clearAllMocks();
  });

  it('refreshes the final result when returning from checkout', async () => {
    jest.mocked(fetchQuizResult).mockResolvedValue(finalResult);
    const onResult = jest.fn<void, [QuizV2Result]>();

    const { rerender } = renderHook(
      ({ tick }: { tick: number }) => {
        void tick;
        return useQuizFinalResultRefresh({
          attemptId: 'attempt-1',
          enabled: true,
          expectedUserId: 'user-1',
          onResult,
        });
      },
      { initialProps: { tick: 0 } }
    );

    mockFocused = true;
    act(() => rerender({ tick: 1 }));
    await waitFor(() => expect(fetchQuizResult).toHaveBeenCalledTimes(0));

    mockFocused = false;
    act(() => rerender({ tick: 2 }));
    mockFocused = true;
    act(() => rerender({ tick: 3 }));

    await waitFor(() => expect(fetchQuizResult).toHaveBeenCalledTimes(1));
    expect(fetchQuizResult).toHaveBeenCalledWith({
      attemptId: 'attempt-1',
      expectedUserId: 'user-1',
    });
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(finalResult));
  });

  it('does not apply a result that is still pending after focus returns', async () => {
    jest.mocked(fetchQuizResult).mockResolvedValue({
      ...finalResult,
      availability: 'pending',
    });
    const onResult = jest.fn<void, [QuizV2Result]>();
    const { rerender } = renderHook(
      ({ tick }: { tick: number }) => {
        void tick;
        return useQuizFinalResultRefresh({
          attemptId: 'attempt-1',
          enabled: true,
          expectedUserId: 'user-1',
          onResult,
        });
      },
      { initialProps: { tick: 0 } }
    );

    mockFocused = true;
    act(() => rerender({ tick: 1 }));
    mockFocused = false;
    act(() => rerender({ tick: 2 }));
    mockFocused = true;
    act(() => rerender({ tick: 3 }));

    await waitFor(() => expect(fetchQuizResult).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });
    expect(onResult).not.toHaveBeenCalled();
  });

  it('ignores a failed refresh after focus returns', async () => {
    jest.mocked(fetchQuizResult).mockRejectedValue(new Error('offline'));
    const onResult = jest.fn<void, [QuizV2Result]>();
    const { rerender } = renderHook(
      ({ tick }: { tick: number }) => {
        void tick;
        return useQuizFinalResultRefresh({
          attemptId: 'attempt-1',
          enabled: true,
          expectedUserId: 'user-1',
          onResult,
        });
      },
      { initialProps: { tick: 0 } }
    );

    mockFocused = true;
    act(() => rerender({ tick: 1 }));
    mockFocused = false;
    act(() => rerender({ tick: 2 }));
    mockFocused = true;
    act(() => rerender({ tick: 3 }));

    await waitFor(() => expect(fetchQuizResult).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });
    expect(onResult).not.toHaveBeenCalled();
  });
});
