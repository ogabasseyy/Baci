import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type { QuizLeaderboardEntry } from '@/services/quiz-types';
import { createQuizStyles } from './QuizScreen.styles';
import { QuizStandingsPodium } from './QuizStandingsPodium';
import { QUIZ_STAGE_COLORS } from './quiz-stage-colors';

function entry(
  rank: number,
  overrides: Partial<QuizLeaderboardEntry> = {}
): QuizLeaderboardEntry {
  return {
    displayName: `player${rank}`,
    isCurrentCustomer: false,
    rank,
    score: 10 - rank,
    status: 'scored',
    submittedAt: null,
    totalTimeSeconds: 30,
    ...overrides,
  };
}

const styles = createQuizStyles(QUIZ_STAGE_COLORS);

describe('QuizStandingsPodium', () => {
  it('draws nothing until three players are ranked', () => {
    render(
      <QuizStandingsPodium entries={[entry(1), entry(2)]} styles={styles} />
    );
    expect(screen.queryByTestId('quiz-standings-podium')).toBeNull();
  });

  it('labels the three ranks and calls the player "You"', () => {
    render(
      <QuizStandingsPodium
        entries={[entry(1), entry(2, { isCurrentCustomer: true }), entry(3)]}
        styles={styles}
      />
    );
    expect(screen.getByLabelText('Rank 1, player1, score 9')).toBeTruthy();
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByText('player3')).toBeTruthy();
  });

  it('bugfix: rival avatars wore the highlight meant for the player only', () => {
    render(
      <QuizStandingsPodium
        entries={[entry(1), entry(2, { isCurrentCustomer: true }), entry(3)]}
        styles={styles}
      />
    );
    expect(screen.getByLabelText('Avatar for player1')).toHaveStyle({
      backgroundColor: QUIZ_STAGE_COLORS.card,
    });
    expect(screen.getByLabelText('Avatar for player2')).toHaveStyle({
      backgroundColor: QUIZ_STAGE_COLORS.primaryLowOpacity,
    });
  });

  it('shows finish times only when asked to', () => {
    const entries = [
      entry(1, { totalTimeSeconds: 12.5 }),
      entry(2, { totalTimeSeconds: 81.49 }),
      entry(3, { totalTimeSeconds: null }),
    ];
    const { rerender } = render(
      <QuizStandingsPodium entries={entries} styles={styles} />
    );
    expect(screen.queryByText('12.50s')).toBeNull();

    rerender(
      <QuizStandingsPodium entries={entries} showFinishTime styles={styles} />
    );
    expect(screen.getByText('12.50s')).toBeTruthy();
    expect(screen.getByText('1:21.49')).toBeTruthy();
  });
});
