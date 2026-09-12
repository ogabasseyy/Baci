import { jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QuizResultsActions } from './QuizResultsActions';
import { createQuizStyles, type QuizThemeColors } from './QuizScreen.styles';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
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

describe('QuizResultsActions', () => {
  beforeEach(() => mockPush.mockClear());

  it('renders both final-result actions in one bottom dock', () => {
    const onReturnToQuizList = jest.fn();
    render(
      <QuizResultsActions
        onReturnToQuizList={onReturnToQuizList}
        returnLabel="Back to quizzes"
        showHistory
        styles={createQuizStyles(colors)}
      />
    );

    fireEvent.press(
      screen.getByRole('button', { name: 'View past quiz leaderboards' })
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Return to quiz list' })
    );

    expect(mockPush).toHaveBeenCalledWith('/quiz/leaderboards');
    expect(onReturnToQuizList).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when no result action is available', () => {
    render(
      <QuizResultsActions
        returnLabel="Back to quizzes"
        showHistory={false}
        styles={createQuizStyles(colors)}
      />
    );

    expect(screen.queryByTestId('quiz-results-actions')).toBeNull();
  });

  it('labels the pending-result return action as Play again', () => {
    render(
      <QuizResultsActions
        onReturnToQuizList={jest.fn()}
        returnLabel="Play again"
        showHistory={false}
        styles={createQuizStyles(colors)}
      />
    );

    expect(screen.getByRole('button', { name: 'Play again' })).toBeTruthy();
  });
});
