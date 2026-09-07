import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QuizResultRoute } from './QuizResultRoute';
import { createQuizStyles } from './QuizScreen.styles';

jest.mock('./QuizResultsPanel', () => ({
  QuizResultsPanel: ({
    allowPendingResultsExit,
    onReturnToQuizList,
    simulatedPrize,
  }: {
    allowPendingResultsExit: boolean;
    onReturnToQuizList: () => void;
    simulatedPrize?: { name: string } | null;
  }) => {
    const React = jest.requireActual('react') as typeof import('react');
    const { Button, Text } = jest.requireActual(
      'react-native'
    ) as typeof import('react-native');
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(Text, null, String(allowPendingResultsExit)),
      simulatedPrize
        ? React.createElement(
            Text,
            null,
            `Simulated prize: ${simulatedPrize.name}`
          )
        : null,
      React.createElement(Button, {
        onPress: onReturnToQuizList,
        title: 'return',
      })
    );
  },
}));

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

describe('QuizResultRoute', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('dismisses the retained result only when another attempt is available', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-16T12:04:00.000Z'));
    const dismissRecovery = jest.fn();
    const onReset = jest.fn();
    const onRetryRecovery = jest.fn();
    const backHandlerRef = { current: null as (() => void) | null };
    render(
      <QuizResultRoute
        backHandlerRef={backHandlerRef}
        dismissRecovery={dismissRecovery}
        events={[
          {
            endsAt: '2026-08-16T12:05:00.000Z',
            id: 'event-1',
            maxAttempts: 2,
            prizeName: 'Phone',
            questionCount: 1,
            startsAt: '2026-08-16T12:00:00.000Z',
            status: 'active',
            title: 'Retryable quiz',
          },
        ]}
        expectedUserId="user-1"
        lifecycle="pending_results"
        onReset={onReset}
        onRetryRecovery={onRetryRecovery}
        result={null}
        styles={styles}
        terminalContext={{
          attemptId: 'attempt-1',
          eventEndsAt: '2026-08-16T12:05:00.000Z',
          eventId: 'event-1',
          serverNow: '2026-08-16T12:04:00.000Z',
          contractVersion: 2,
        }}
        v2Result={{
          attemptId: 'attempt-1',
          availability: 'pending',
          availableAt: null,
        }}
      />
    );

    expect(screen.getByText('true')).toBeTruthy();
    act(() => backHandlerRef.current?.());
    expect(dismissRecovery).toHaveBeenCalledWith('event-1');
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onRetryRecovery).toHaveBeenCalledTimes(1);
  });

  it('removes play again when the universal event deadline advances past the player', () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    render(
      <QuizResultRoute
        dismissRecovery={jest.fn()}
        events={[
          {
            endsAt: new Date(5_000).toISOString(),
            id: 'event-1',
            maxAttempts: 2,
            prizeName: 'Phone',
            questionCount: 1,
            startsAt: new Date(0).toISOString(),
            status: 'active',
            title: 'Retryable quiz',
          },
        ]}
        expectedUserId="user-1"
        lifecycle="pending_results"
        onReset={jest.fn()}
        onRetryRecovery={jest.fn()}
        result={null}
        styles={styles}
        terminalContext={{
          attemptId: 'attempt-1',
          eventEndsAt: new Date(5_000).toISOString(),
          eventId: 'event-1',
          serverNow: new Date(0).toISOString(),
          contractVersion: 2,
        }}
        v2Result={{
          attemptId: 'attempt-1',
          availability: 'pending',
          availableAt: null,
        }}
      />
    );

    expect(screen.getByText('true')).toBeTruthy();
    act(() => {
      jest.advanceTimersByTime(5_250);
    });
    expect(screen.getByText('false')).toBeTruthy();
  });

  it('dismisses a fresh final prize result before rearming recovery', () => {
    const dismissRecovery = jest.fn();
    render(
      <QuizResultRoute
        dismissRecovery={dismissRecovery}
        events={[
          {
            endsAt: '2026-08-16T12:05:00.000Z',
            id: 'event-1',
            maxAttempts: 1,
            prizeName: 'Phone',
            questionCount: 1,
            startsAt: '2026-08-16T12:00:00.000Z',
            status: 'completed',
            title: 'Prize quiz',
          },
        ]}
        expectedUserId="user-1"
        lifecycle="final"
        onReset={jest.fn()}
        onRetryRecovery={jest.fn()}
        result={null}
        styles={styles}
        terminalContext={{
          attemptId: 'attempt-1',
          eventEndsAt: '2026-08-16T12:05:00.000Z',
          eventId: 'event-1',
          serverNow: '2026-08-16T12:05:00.000Z',
          contractVersion: 2,
        }}
        v2Result={{
          attemptId: 'attempt-1',
          availability: 'final',
          availableAt: '2026-08-16T12:06:00.000Z',
          prizeClaim: {
            awardId: 'award-1',
            cartPath: '/checkout',
            condition: null,
            productId: 'product-1',
            variantId: null,
            voucherToken: 'voucher-1',
          },
          rank: 1,
          score: 1,
          totalQuestions: 1,
        }}
      />
    );

    fireEvent.press(screen.getByRole('button', { name: 'return' }));
    expect(dismissRecovery).toHaveBeenCalledWith('event-1');
  });

  it('offers the selected prize as a simulation only to the test winner', () => {
    const renderTestResult = (rank: number) =>
      render(
        <QuizResultRoute
          dismissRecovery={jest.fn()}
          events={[
            {
              endsAt: '2026-08-16T12:05:00.000Z',
              id: 'event-1',
              maxAttempts: 1,
              mode: 'test',
              prizeName: 'iPhone XR',
              prizeProduct: {
                condition: 'used',
                id: 'product-1',
                imageUrl: 'https://example.com/iphone.jpg',
                name: 'iPhone XR',
                variantId: null,
              },
              questionCount: 1,
              startsAt: '2026-08-16T12:00:00.000Z',
              status: 'completed',
              title: 'Prize quiz',
            },
          ]}
          expectedUserId="user-1"
          lifecycle="final"
          onReset={jest.fn()}
          onRetryRecovery={jest.fn()}
          result={null}
          styles={styles}
          terminalContext={{
            attemptId: 'attempt-1',
            eventEndsAt: '2026-08-16T12:05:00.000Z',
            eventId: 'event-1',
            serverNow: '2026-08-16T12:05:00.000Z',
            contractVersion: 2,
          }}
          v2Result={{
            attemptId: 'attempt-1',
            availability: 'final',
            availableAt: '2026-08-16T12:05:00.000Z',
            rank,
            score: 1,
            totalQuestions: 1,
          }}
        />
      );

    const winner = renderTestResult(1);
    expect(screen.getByText('Simulated prize: iPhone XR')).toBeTruthy();
    winner.unmount();

    renderTestResult(2);
    expect(screen.queryByText('Simulated prize: iPhone XR')).toBeNull();
  });
});
