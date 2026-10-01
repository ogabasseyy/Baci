import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { QuizLeaderboardParticipantCount } from './QuizLeaderboardParticipantCount';
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

describe('QuizLeaderboardParticipantCount', () => {
  it('uses singular copy for one participant', () => {
    render(<QuizLeaderboardParticipantCount count={1} styles={styles} />);
    expect(screen.getByText('1 participant')).toBeTruthy();
  });

  it('uses plural copy for multiple participants', () => {
    render(<QuizLeaderboardParticipantCount count={2} styles={styles} />);
    expect(screen.getByText('2 participants')).toBeTruthy();
  });
});
