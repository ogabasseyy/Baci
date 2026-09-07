import { jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

const mockPush = jest.fn();
jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: jest.fn(),
}));

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: mockPush }),
}));
jest.mock('@/components/quiz/QuizRouteBackButton', () => ({
  QuizRouteBackButton: () => null,
}));
jest.mock('@/components/quiz/QuizScreen', () => ({
  QuizScreen: ({ onSignIn }: { onSignIn?: () => void }) => {
    const {
      Pressable: MockPressable,
      Text: MockText,
    } = require('react-native');
    return (
      <MockPressable accessibilityRole="button" onPress={onSignIn}>
        <MockText>Sign in to play</MockText>
      </MockPressable>
    );
  },
}));
jest.mock('@/components/storefront/StorefrontScreenShell', () => ({
  StorefrontScreenShell: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));
jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ colors: { text: '#fff', primary: '#f90' } }),
}));

import QuizRoute from '@/app/quiz';

describe('QuizRoute sign-in handoff', () => {
  beforeEach(() => mockPush.mockClear());

  it('opens login as a modal so successful sign-in dismisses back to the quiz', () => {
    render(<QuizRoute />);

    fireEvent.press(screen.getByRole('button', { name: 'Sign in to play' }));

    expect(mockPush).toHaveBeenCalledWith('/auth/login');
  });
});
