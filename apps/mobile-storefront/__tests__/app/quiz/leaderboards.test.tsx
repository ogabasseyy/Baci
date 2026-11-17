import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import QuizLeaderboardsRoute from '@/app/quiz/leaderboards';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useIsFocused: () => true,
}));
jest.mock('@/components/quiz/QuizLeaderboardScreen', () => ({
  QuizLeaderboardScreen: () => {
    const { Text } =
      jest.requireActual<typeof import('react-native')>('react-native');
    return <Text>Leaderboard browser</Text>;
  },
}));

describe('/quiz/leaderboards screen', () => {
  it('renders the previous quiz leaderboard browser', () => {
    render(<QuizLeaderboardsRoute />);
    expect(screen.getByText('Leaderboard browser')).toBeTruthy();
  });
});
