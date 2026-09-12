import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { fetchQuizLiveLeaderboard } from '@/services/quiz-live-leaderboard';
import { fetchQuizParticipantCount } from '@/services/quiz-participant-count';
import { QuizResultsPanel } from './QuizResultsPanel';
import { createQuizStyles, type QuizThemeColors } from './QuizScreen.styles';

jest.mock('./QuizPrizeClaimPanel', () => ({
  QuizPrizeClaimPanel: () => {
    const React = jest.requireActual('react') as typeof import('react');
    const { Text } = jest.requireActual(
      'react-native'
    ) as typeof import('react-native');
    return React.createElement(Text, null, 'Claim your prize');
  },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('@/services/quiz-leaderboard', () => ({
  fetchQuizLeaderboard: jest.fn(),
}));
jest.mock('@/services/quiz-live-leaderboard', () => ({
  fetchQuizLiveLeaderboard: jest.fn(),
}));
jest.mock('@/services/quiz-participant-count', () => ({
  fetchQuizParticipantCount: jest.fn(),
}));

const colors: QuizThemeColors = {
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
};

const simulatedPrize = {
  condition: 'used' as const,
  id: 'product-1',
  imageUrl: null,
  name: 'iPhone XR',
  variantId: null,
};

const finalResult = {
  attemptId: 'a1',
  availability: 'final' as const,
  availableAt: new Date(0).toISOString(),
  rank: 1,
  score: 4,
  totalQuestions: 5,
};

describe('QuizResultsPanel', () => {
  beforeEach(() => {
    jest.mocked(fetchQuizLiveLeaderboard).mockReset();
    jest.mocked(fetchQuizParticipantCount).mockReset();
    jest.mocked(fetchQuizParticipantCount).mockResolvedValue(1);
  });

  it('celebrates completion and explains the server-recorded tie-break time', () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    jest.mocked(fetchQuizLiveLeaderboard).mockResolvedValue({
      currentPlayer: {
        displayName: 'Bassey',
        isCurrentCustomer: true,
        rank: 1,
        score: 4,
        status: 'submitted',
        submittedAt: new Date(0).toISOString(),
        totalTimeSeconds: 10,
      },
      entries: [],
      participantCount: 1,
      status: 'live',
    });
    render(
      <QuizResultsPanel
        eventId="event-1"
        eventEndsAt={new Date(30_000).toISOString()}
        expectedUserId="user-1"
        legacyResult={null}
        lifecycle="pending_results"
        serverNow={new Date(0).toISOString()}
        styles={createQuizStyles(colors)}
        v2Result={{
          attemptId: 'a1',
          availability: 'pending',
          availableAt: null,
        }}
      />
    );
    expect(screen.getByText("You're all done!")).toBeTruthy();
    expect(screen.getByText('You finished at')).toBeTruthy();
    expect(screen.getByText(/:\d{2}:\d{2}/)).toBeTruthy();
    expect(
      screen.getByText('Finish time will be used as a tie breaker')
    ).toBeTruthy();
    expect(
      screen.getByText('The leaderboard will appear when the quiz ends in')
    ).toBeTruthy();
    expect(screen.getByRole('timer').props.children).toBe('0:30');
    jest.useRealTimers();
  });

  it('offers a simulated checkout for a final test prize', () => {
    render(
      <QuizResultsPanel
        legacyResult={null}
        lifecycle="final"
        simulatedPrize={simulatedPrize}
        styles={createQuizStyles(colors)}
        v2Result={finalResult}
      />
    );

    expect(screen.getByText('Winner checkout preview')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Redeem prize' })).toBeTruthy();
  });

  it('prefers a signed prize claim over a simulated prize', () => {
    render(
      <QuizResultsPanel
        legacyResult={null}
        lifecycle="final"
        simulatedPrize={simulatedPrize}
        styles={createQuizStyles(colors)}
        v2Result={{
          ...finalResult,
          prizeClaim: {
            awardId: 'award-1',
            cartPath: '/checkout',
            condition: 'used',
            productId: 'product-1',
            variantId: null,
            voucherToken: 'signed-voucher',
          },
        }}
      />
    );

    expect(screen.getByText('Claim your prize')).toBeTruthy();
    expect(screen.queryByText('Winner checkout preview')).toBeNull();
  });

  it('does not render a simulated checkout without a selected prize', () => {
    render(
      <QuizResultsPanel
        legacyResult={null}
        lifecycle="final"
        simulatedPrize={null}
        styles={createQuizStyles(colors)}
        v2Result={finalResult}
      />
    );

    expect(screen.queryByText('Winner checkout preview')).toBeNull();
    expect(screen.queryByText('Claim your prize')).toBeNull();
  });
});
