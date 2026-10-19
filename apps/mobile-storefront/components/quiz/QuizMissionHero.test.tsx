import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { QuizMissionHero } from './QuizMissionHero';

jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('@react-native-vector-icons/ionicons', () => 'Ionicons');

describe('QuizMissionHero', () => {
  it('tells the SuperQuiz mission as an energetic, concise story', () => {
    render(<QuizMissionHero />);

    expect(screen.getByText("OGABASSEY'S SUPERQUIZ")).toBeTruthy();
    expect(
      screen.getByRole('header', { name: 'Play for more than the prize.' })
    ).toBeTruthy();
    expect(
      screen.getByText(
        "We're putting smartphones within reach of more Nigerians so more people can learn, earn and connect."
      )
    ).toBeTruthy();
    expect(screen.getByLabelText('Learn, earn, connect')).toBeTruthy();
    expect(screen.getByText(/close the digital divide/i)).toBeTruthy();
  });

  it('opens an addressed sponsorship email', () => {
    const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    render(<QuizMissionHero />);

    fireEvent.press(screen.getByRole('link', { name: 'Sponsor SuperQuiz' }));

    expect(openUrl).toHaveBeenCalledWith(
      'mailto:support@ogabassey.com?subject=SuperQuiz%20Sponsorship'
    );
    openUrl.mockRestore();
  });
});
