import { describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { useIsFocused } from 'expo-router';
import { StatusBar } from 'react-native';
import { QuizStageStatusBar } from './QuizStageStatusBar';

jest.mock('expo-router', () => ({ useIsFocused: jest.fn() }));

describe('QuizStageStatusBar', () => {
  it('uses light icons while the quiz is the focused screen', () => {
    jest.mocked(useIsFocused).mockReturnValue(true);
    const view = render(<QuizStageStatusBar />);
    expect(view.UNSAFE_getByType(StatusBar).props.barStyle).toBe(
      'light-content'
    );
  });

  it('bugfix: light icons stayed on when another screen covered the quiz', () => {
    jest.mocked(useIsFocused).mockReturnValue(false);
    const view = render(<QuizStageStatusBar />);
    expect(view.UNSAFE_queryByType(StatusBar)).toBeNull();
  });
});
