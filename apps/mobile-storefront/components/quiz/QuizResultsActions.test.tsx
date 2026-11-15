import { jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QuizResultsActions } from './QuizResultsActions';
import { createQuizStyles } from './QuizScreen.styles';
import type { QuizThemeColors } from './quiz-theme';

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

  it('shows the tries left beside Play again when known', () => {
    render(
      <QuizResultsActions
        onReturnToQuizList={jest.fn()}
        returnLabel="Play again"
        showHistory={false}
        styles={createQuizStyles(colors)}
        triesLeft={2}
      />
    );

    expect(screen.getByText('Play again · 2 tries left')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Play again · 2 tries left' })
    ).toBeTruthy();
  });

  it('uses the singular for one try left', () => {
    render(
      <QuizResultsActions
        onReturnToQuizList={jest.fn()}
        returnLabel="Play again"
        showHistory={false}
        styles={createQuizStyles(colors)}
        triesLeft={1}
      />
    );

    expect(screen.getByText('Play again · 1 try left')).toBeTruthy();
  });

  it('keeps plain Play again when the count is unknown', () => {
    render(
      <QuizResultsActions
        onReturnToQuizList={jest.fn()}
        returnLabel="Play again"
        showHistory={false}
        styles={createQuizStyles(colors)}
        triesLeft={null}
      />
    );

    expect(screen.getByText('Play again')).toBeTruthy();
  });

  it('never adds a count to Back to quizzes', () => {
    render(
      <QuizResultsActions
        onReturnToQuizList={jest.fn()}
        returnLabel="Back to quizzes"
        showHistory={false}
        styles={createQuizStyles(colors)}
        triesLeft={2}
      />
    );

    expect(screen.getByText('Back to quizzes')).toBeTruthy();
  });
});
