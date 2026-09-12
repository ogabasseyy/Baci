import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type { QuizLeaderboardEntry } from '@/services/quiz-types';
import { QuizLeaderboardRow } from './QuizLeaderboardRow';
import { createQuizLeaderboardStyles } from './QuizLeaderboardScreen.styles';

const styles = createQuizLeaderboardStyles({
  background: '#000000',
  border: '#111111',
  card: '#222222',
  error: '#ff0000',
  muted: '#333333',
  primary: '#0000ff',
  primaryLowOpacity: 'rgba(0,0,255,0.1)',
  primaryForeground: '#ffffff',
  success: '#00ff00',
  text: '#ffffff',
  textSecondary: '#cccccc',
  warning: '#ffff00',
});
const entry: QuizLeaderboardEntry = {
  displayName: 'Player-AB12CD34',
  isCurrentCustomer: true,
  rank: 2,
  score: 18,
  status: 'ranked',
  submittedAt: null,
  totalTimeSeconds: 120,
};

describe('QuizLeaderboardRow', () => {
  it('renders the rank, player name, and score accessibly', () => {
    render(<QuizLeaderboardRow entry={entry} styles={styles} />);

    expect(
      screen.getByLabelText('Rank 2, Player-AB12CD34, score 18')
    ).toBeTruthy();
    expect(screen.getByText('#2')).toBeTruthy();
    expect(screen.getByText('Player-AB12CD34  (You)')).toBeTruthy();
    expect(screen.getByText('18 pts')).toBeTruthy();
    expect(screen.getByText('2:00.00')).toBeTruthy();
    expect(screen.getByLabelText('Avatar for Player-AB12CD34')).toBeTruthy();
  });
});
