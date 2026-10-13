import { fireEvent, render, screen } from '@testing-library/react-native';
import { createQuizStyles } from './QuizScreen.styles';
import { QuizScreenFeedback } from './QuizScreenFeedback';

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

it('retries a failed lobby load when its retry control is pressed', () => {
  const onRetry = jest.fn();
  render(
    <QuizScreenFeedback
      status="ready"
      error="Offline"
      isDobGateVisible={false}
      onRetry={onRetry}
      primaryColor="#f90"
      styles={styles}
    />
  );
  fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

it('shows lobby loading and suppresses an error already owned by the DOB gate', () => {
  render(
    <QuizScreenFeedback
      status="loading"
      error="DOB required"
      isDobGateVisible
      onRetry={jest.fn()}
      primaryColor="#f90"
      styles={styles}
    />
  );
  expect(screen.getByLabelText('Loading quiz events')).toBeTruthy();
  expect(screen.queryByText('DOB required')).toBeNull();
});
it('keeps gameplay errors from offering a lobby retry that would interrupt the attempt', () => {
  render(
    <QuizScreenFeedback
      status="question"
      error="Offline"
      isDobGateVisible={false}
      onRetry={jest.fn()}
      primaryColor="#f90"
      styles={styles}
    />
  );
  expect(screen.getByText('We couldn’t continue the quiz')).toBeTruthy();
  expect(screen.getByText('Offline')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
});
