import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QuizRulesModal } from './QuizRulesModal';

jest.mock('@react-native-vector-icons/ionicons', () => 'Ionicons');
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 59 }),
}));

describe('QuizRulesModal', () => {
  it('requires one explicit rules and terms acknowledgment before play', () => {
    const onConfirm = jest.fn();
    render(
      <QuizRulesModal
        eventTitle="Tonight quiz"
        onClose={jest.fn()}
        onConfirm={onConfirm}
        requiresAcceptance
        timePerQuestionSeconds={10}
        visible
      />
    );

    const play = screen.getByRole('button', { name: 'Accept and play quiz' });
    expect(screen.getByText(/entry is free/i)).toBeTruthy();
    expect(screen.getByText(/no random draw/i)).toBeTruthy();
    expect(play.props.accessibilityState).toEqual({ disabled: true });
    fireEvent.press(play);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.press(
      screen.getByRole('checkbox', { name: 'Accept quiz rules and terms' })
    );
    fireEvent.press(play);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('places the banner below the top safe-area inset', () => {
    // Regression: a fixed offset hides the creative under the status bar
    // or cutout on tall-inset devices, producing obscured impressions.
    render(
      <QuizRulesModal
        eventTitle="Tonight quiz"
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        requiresAcceptance={false}
        timePerQuestionSeconds={15}
        visible
      />
    );

    // Mocked top inset is 59, so the reserved slot starts at 75. (Prop
    // query: testID queries do not traverse the Modal host in this setup.)
    const banner = screen.UNSAFE_getByProps({
      testID: 'quiz-rules-modal-banner',
    }) as unknown as {
      props: { style: Record<string, unknown> };
    };
    expect(banner.props.style).toEqual(expect.objectContaining({ top: 75 }));
  });

  it('shows rules without an acknowledgment when opened for reference', () => {
    const onClose = jest.fn();
    render(
      <QuizRulesModal
        eventTitle="Tonight quiz"
        onClose={onClose}
        onConfirm={jest.fn()}
        requiresAcceptance={false}
        timePerQuestionSeconds={15}
        visible
      />
    );

    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Close rules' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
