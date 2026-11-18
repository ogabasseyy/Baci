import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { QuizAdBreakNotice } from './QuizAdBreakNotice';

describe('QuizAdBreakNotice', () => {
  it('tells the player an ad is coming and that their place is kept', () => {
    render(<QuizAdBreakNotice />);

    expect(screen.getByText('Short ad break')).toBeTruthy();
    expect(screen.getByText('Your place in the quiz is saved.')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('covers the whole screen and takes every touch', () => {
    render(<QuizAdBreakNotice />);

    const cover = screen.getByTestId('quiz-ad-break-notice');
    expect(cover).toHaveStyle({
      bottom: 0,
      left: 0,
      position: 'absolute',
      right: 0,
      top: 0,
    });
    expect(cover.props.onStartShouldSetResponder()).toBe(true);
  });
});
