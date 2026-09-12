import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { QuizEvent } from '@/services/quiz-types';
import { QuizWaitingRoom } from './QuizWaitingRoom';

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#fff',
      border: '#ddd',
      card: '#fff',
      error: '#f00',
      muted: '#aaa',
      primary: '#f90',
      primaryLowOpacity: '#321',
      primaryForeground: '#000',
      success: '#0f8',
      text: '#111',
      textSecondary: '#666',
      warning: '#fb0',
    },
  }),
}));

const scheduled: QuizEvent = {
  endsAt: '2099-01-01T01:10:00.000Z',
  id: 'event-1',
  prizeName: 'Phone',
  questionCount: 10,
  startsAt: '2099-01-01T01:00:00.000Z',
  status: 'scheduled',
  title: 'Noon Quiz',
  serverNow: '2099-01-01T00:59:00.000Z',
  timePerQuestionSeconds: 10,
};

describe('QuizWaitingRoom', () => {
  it('renders event details and leaves on request', () => {
    const onExit = jest.fn();
    render(
      <QuizWaitingRoom
        event={scheduled}
        onExit={onExit}
        onStart={jest.fn()}
        refresh={jest.fn(async () => [scheduled])}
      />
    );
    expect(screen.getByText('Noon Quiz')).toBeTruthy();
    expect(screen.getByText('Win Phone')).toBeTruthy();
    expect(screen.getByText('10 questions')).toBeTruthy();
    expect(
      screen.getByLabelText('Waiting room for Noon Quiz').props.edges
    ).toBeUndefined();
    const scrollView = screen.getByLabelText(
      'Scrollable SuperQuiz waiting room'
    );
    expect(scrollView.props.keyboardShouldPersistTaps).toBe('handled');
    expect(scrollView.props.showsVerticalScrollIndicator).toBe(false);
    expect(scrollView.props.contentContainerStyle).toEqual(
      expect.objectContaining({ flexGrow: 1, paddingBottom: 40 })
    );
    fireEvent.press(screen.getByRole('button', { name: 'Leave waiting room' }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
