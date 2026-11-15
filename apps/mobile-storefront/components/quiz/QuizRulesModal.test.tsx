import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import Colors from '@/constants/Colors';
import { QuizRulesModal } from './QuizRulesModal';
import { QUIZ_STAGE_COLORS } from './quiz-stage-colors';

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

  it('caps the sheet so it cannot cover the banner on compact screens', () => {
    // Regression: the bottom-anchored sheet grows unbounded, so on short
    // screens it paints over the top banner zone and hides the creative.
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

    const sheet = screen.UNSAFE_getByProps({
      accessibilityViewIsModal: true,
    }) as unknown as {
      props: { style: Record<string, unknown>[] };
    };
    expect(sheet.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ maxHeight: '75%' })])
    );

    // Once the banner is measured the sheet stops a clear 24pt below it,
    // so the sheet's close button can never sit right under the ad.
    // The banner is a sibling of the modal sheet, so it is hidden from
    // accessibility queries by default.
    fireEvent(
      screen.getByTestId('quiz-rules-modal-banner', {
        includeHiddenElements: true,
      }),
      'layout',
      { nativeEvent: { layout: { height: 78, width: 390, x: 0, y: 75 } } }
    );
    const { height: windowHeight } = Dimensions.get('window');
    const measuredSheet = screen.UNSAFE_getByProps({
      accessibilityViewIsModal: true,
    }) as unknown as {
      props: { style: Record<string, unknown>[] };
    };
    expect(measuredSheet.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ maxHeight: windowHeight - 153 - 24 }),
      ])
    );
    expect(screen.getByTestId('quiz-rules-list')).toBeTruthy();
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
  describe('bugfix: accept button looked active before the terms box was ticked', () => {
    it('dims the play button until the rules are accepted', () => {
      render(
        <QuizRulesModal
          eventTitle="Tonight quiz"
          onClose={jest.fn()}
          onConfirm={jest.fn()}
          requiresAcceptance
          timePerQuestionSeconds={10}
          visible
        />
      );

      expect(screen.getByText('Accept & play')).toHaveStyle({
        color: QUIZ_STAGE_COLORS.textSecondary,
      });

      fireEvent.press(
        screen.getByRole('checkbox', { name: 'Accept quiz rules and terms' })
      );

      expect(screen.getByText('Accept & play')).toHaveStyle({
        color: Colors.light.primaryForeground,
      });
    });
  });

  describe('bugfix: measured banner edge cases', () => {
    const banner = () =>
      screen.getByTestId('quiz-rules-modal-banner', {
        includeHiddenElements: true,
      });
    const sheetStyle = () =>
      (
        screen.UNSAFE_getByProps({
          accessibilityViewIsModal: true,
        }) as unknown as { props: { style: Record<string, unknown>[] } }
      ).props.style;
    const measure = (height: number) =>
      fireEvent(banner(), 'layout', {
        nativeEvent: { layout: { height, width: 390, x: 0, y: 75 } },
      });
    const modal = (visible: boolean) => (
      <QuizRulesModal
        eventTitle="Tonight quiz"
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        requiresAcceptance={false}
        timePerQuestionSeconds={15}
        visible={visible}
      />
    );

    it('drops the banner instead of collapsing the sheet when there is no room', () => {
      render(modal(true));
      const { height: windowHeight } = Dimensions.get('window');

      // A banner so tall that under 320pt would be left for the sheet.
      measure(windowHeight - 75 - 24 - 200);

      expect(sheetStyle()).toEqual(
        expect.arrayContaining([expect.objectContaining({ maxHeight: '75%' })])
      );
      expect(banner().props.children).toBeNull();
      expect(screen.getByTestId('quiz-rules-list')).toBeTruthy();
    });

    it('forgets the last banner measurement when the sheet closes', () => {
      const { rerender } = render(modal(true));
      measure(78);
      expect(sheetStyle()).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ maxHeight: '75%' })])
      );

      rerender(modal(false));
      rerender(modal(true));

      expect(sheetStyle()).toEqual(
        expect.arrayContaining([expect.objectContaining({ maxHeight: '75%' })])
      );
    });
  });
});
