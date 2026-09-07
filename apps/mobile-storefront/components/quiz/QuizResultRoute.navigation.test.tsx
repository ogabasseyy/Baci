import { act, render } from '@testing-library/react-native';
import {
  createQuizRecoveryEnvelope,
  loadQuizRecoveryEnvelope,
  saveQuizRecoveryEnvelope,
} from '@/stores/quiz-recovery-envelope';
import { useQuizStore } from '@/stores/quiz-store';
import { QuizResultRoute } from './QuizResultRoute';
import { createQuizStyles } from './QuizScreen.styles';

jest.mock('./QuizResultsPanel', () => ({ QuizResultsPanel: () => null }));
afterEach(() => useQuizStore.getState().resetForAccountChange());
const styles = createQuizStyles({
  background: '#000',
  border: '#222',
  card: '#111',
  error: '#f00',
  muted: '#555',
  primary: '#f90',
  primaryLowOpacity: '#321',
  primaryForeground: '#000',
  success: '#0f8',
  text: '#fff',
  textSecondary: '#aaa',
  warning: '#fb0',
});

it.each([
  'pending_results',
  'final',
] as const)('routes header back through the %s exit policy', (lifecycle) => {
  const backHandlerRef = { current: null as (() => void) | null };
  const dismissRecovery = jest.fn();
  const onReset = jest.fn();
  const onRetryRecovery = jest.fn();
  render(
    <QuizResultRoute
      backHandlerRef={backHandlerRef}
      dismissRecovery={dismissRecovery}
      events={[]}
      expectedUserId="user"
      lifecycle={lifecycle}
      onReset={onReset}
      onRetryRecovery={onRetryRecovery}
      result={null}
      styles={styles}
      terminalContext={{
        attemptId: 'attempt',
        eventId: 'event',
        contractVersion: 2,
      }}
      v2Result={null}
    />
  );

  expect(backHandlerRef.current).toEqual(expect.any(Function));
  act(() => backHandlerRef.current?.());
  if (lifecycle === 'pending_results') {
    expect(onReset).not.toHaveBeenCalled();
    expect(dismissRecovery).not.toHaveBeenCalled();
    expect(onRetryRecovery).not.toHaveBeenCalled();
  } else {
    expect(dismissRecovery).toHaveBeenCalledWith('event');
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(dismissRecovery).toHaveBeenCalledTimes(1);
    expect(onRetryRecovery).toHaveBeenCalledTimes(1);
  }
});

it('retains the prize recovery envelope when the final result is dismissed from the header', async () => {
  const terminalContext = {
    attemptId: 'a',
    eventId: 'e',
    contractVersion: 2 as const,
  };
  const v2Result = {
    availability: 'final' as const,
    attemptId: 'a',
    availableAt: '2026-09-05T12:00:00Z',
    rank: 1,
    score: 5,
    totalQuestions: 5,
    prizeClaim: {
      awardId: 'award',
      cartPath: '/checkout',
      condition: null,
      productId: 'product',
      variantId: null,
      voucherToken: 'test-voucher',
    },
  };
  await saveQuizRecoveryEnvelope(
    createQuizRecoveryEnvelope({
      attemptId: 'a',
      eventId: 'e',
      userId: 'u',
      generation: 0,
      currentQuestionId: null,
      pendingLockedOptionId: null,
      startRequestId: '11111111-1111-4111-8111-111111111111',
    })
  );
  useQuizStore.setState({
    status: 'result',
    selectedEventId: 'e',
    recoveryUserId: 'u',
    terminalContext,
    v2Result,
    v2LifecycleStatus: 'final',
  });
  const backHandlerRef = { current: null as (() => void) | null };
  render(
    <QuizResultRoute
      backHandlerRef={backHandlerRef}
      dismissRecovery={jest.fn()}
      events={[]}
      expectedUserId="u"
      lifecycle="final"
      onReset={useQuizStore.getState().reset}
      onRetryRecovery={jest.fn()}
      result={null}
      styles={styles}
      terminalContext={terminalContext}
      v2Result={v2Result}
    />
  );
  act(() => backHandlerRef.current?.());
  expect(useQuizStore.getState().status).toBe('idle');
  expect(await loadQuizRecoveryEnvelope('u', 'e')).toMatchObject({
    attemptId: 'a',
  });
});
