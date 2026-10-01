import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { QuizErrorPanel } from './QuizErrorPanel';
import { createQuizStyles } from './QuizScreen.styles';

jest.mock('@react-native-vector-icons/ionicons', () => 'Ionicons');

const styles = createQuizStyles(Colors.dark);

describe('QuizErrorPanel', () => {
  it('shows a friendly error and retries when allowed', () => {
    const onRetry = jest.fn();
    render(
      <QuizErrorPanel
        description="Please check your connection."
        onRetry={onRetry}
        primaryColor={Colors.dark.primary}
        showRetry
        styles={styles}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Please check your connection.'
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Retry loading quiz events' })
    );
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
