import { act, renderHook } from '@testing-library/react-native';
import { recoverActiveQuizAttempt } from '@/services/quiz-attempt-recovery';
import type { QuizV2Attempt } from '@/services/quiz-types';
import { useQuizStore } from '@/stores/quiz-store';
import { useQuizLobbyNavigation } from './useQuizLobbyNavigation';

jest.mock('@/lib/get-quiz-device-fingerprint', () => ({
  getQuizDeviceFingerprint: async () => null,
}));
jest.mock('@/services/quiz-attempt-recovery', () => ({
  recoverActiveQuizAttempt: jest.fn(async () => ({
    availability: 'pending_results',
    attemptId: 'a',
    serverNow: '2026-09-05T12:00:00Z',
  })),
}));
const active: QuizV2Attempt = {
  attemptId: 'a',
  eventId: 'e',
  eventEndsAt: '2026-09-05T12:05:00Z',
  serverNow: '2026-09-05T12:00:00Z',
  resultsAvailableAt: null,
  status: 'in_progress',
};
afterEach(() => {
  useQuizStore.getState().resetForAccountChange();
  jest.clearAllMocks();
});
it('coalesces repeated resume taps while recovery is starting', async () => {
  useQuizStore.setState({
    status: 'ready',
    v2Attempt: active,
    v2LifecycleStatus: 'in_progress',
  });
  const { result } = renderHook(() =>
    useQuizLobbyNavigation({ dismissRecovery: jest.fn(), userId: 'u' })
  );
  await act(async () => {
    await Promise.all([
      result.current.onResume('e'),
      result.current.onResume('e'),
    ]);
  });
  expect(recoverActiveQuizAttempt).toHaveBeenCalledTimes(1);
});
it('preserves an active attempt when returning to the lobby and resumes through recovery', async () => {
  useQuizStore.setState({
    status: 'question',
    v2Attempt: active,
    v2LifecycleStatus: 'in_progress',
    selectedEventId: 'e',
  });
  const ref = { current: null as (() => void) | null };
  const dismissRecovery = jest.fn();
  const { result } = renderHook(() =>
    useQuizLobbyNavigation({
      backHandlerRef: ref,
      dismissRecovery,
      userId: 'u',
    })
  );
  act(() => ref.current?.());
  expect(useQuizStore.getState()).toMatchObject({
    status: 'ready',
    v2Attempt: active,
  });
  expect(dismissRecovery).toHaveBeenCalledWith('e');
  expect(result.current.resumeEventId).toBe('e');
  await act(async () => result.current.onResume('e'));
  expect(useQuizStore.getState()).toMatchObject({
    status: 'result',
    v2LifecycleStatus: 'pending_results',
    terminalContext: { attemptId: 'a' },
  });
});
it('does not offer a submitted attempt as resumable', () => {
  useQuizStore.setState({
    status: 'ready',
    v2Attempt: { ...active, status: 'submitted_pending_results' },
    v2LifecycleStatus: 'pending_results',
  });
  const { result } = renderHook(() =>
    useQuizLobbyNavigation({ dismissRecovery: jest.fn(), userId: 'u' })
  );
  expect(result.current.resumeEventId).toBeNull();
});
