import { render, screen } from '@testing-library/react-native';
import type { QuizLeaderboard } from '@/services/quiz-types';
import { QuizResultsStandings } from './QuizResultsStandings';
import { createQuizStyles, type QuizThemeColors } from './QuizScreen.styles';

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

describe('QuizResultsStandings', () => {
  it('renders participant count and the current player row', () => {
    const leaderboard: QuizLeaderboard = {
      currentPlayer: {
        displayName: 'Bassey',
        isCurrentCustomer: true,
        rank: 2,
        score: 8,
        status: 'completed',
        submittedAt: null,
        totalTimeSeconds: 12,
      },
      entries: [],
      participantCount: 4,
      status: 'published',
    };

    render(
      <QuizResultsStandings
        leaderboard={leaderboard}
        leaderboardError={false}
        participantCount={4}
        styles={createQuizStyles(colors)}
      />
    );

    expect(screen.getByText('Final standings')).toBeTruthy();
    expect(screen.getByText('4 participants')).toBeTruthy();
    expect(screen.getByText('Bassey  (You)')).toBeTruthy();
  });

  it('keeps a mid-table current player visible after truncation', () => {
    const entries = Array.from({ length: 7 }, (_, index) => ({
      displayName: `Player-${index + 1}`,
      isCurrentCustomer: index === 6,
      rank: index + 1,
      score: 10 - index,
      status: 'ranked',
      submittedAt: null,
      totalTimeSeconds: 60,
    }));
    const leaderboard: QuizLeaderboard = {
      currentPlayer: null,
      entries,
      participantCount: 7,
      status: 'published',
    };

    render(
      <QuizResultsStandings
        leaderboard={leaderboard}
        leaderboardError={false}
        participantCount={7}
        styles={createQuizStyles(colors)}
      />
    );

    expect(screen.getByText('Player-1')).toBeTruthy();
    expect(screen.getByText('Player-7  (You)')).toBeTruthy();
    expect(screen.queryByText('Player-5')).toBeNull();
  });
});
