import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('react-native', async () => {
  const React = await import('react');
  return {
    ActivityIndicator: () => null,
    Pressable: ({
      accessibilityLabel,
      children,
    }: {
      accessibilityLabel?: string;
      children?: ReactNode;
    }) =>
      React.createElement(
        'button',
        { 'aria-label': accessibilityLabel, type: 'button' },
        children
      ),
    StatusBar: () => null,
    Text: ({ children }: { children?: ReactNode }) =>
      React.createElement('span', null, children),
    View: ({ children }: { children?: ReactNode }) =>
      React.createElement('div', null, children),
  };
});

vi.mock('@react-native-vector-icons/ionicons', () => ({ default: () => null }));

vi.mock('@/components/auth/AuthInput', async () => {
  const React = await import('react');
  return {
    AuthInput: ({ label }: { label: string }) =>
      React.createElement('input', { 'aria-label': label }),
  };
});

vi.mock('@/components/auth/LoginSecondaryActions', () => ({
  LoginSecondaryActions: () => null,
}));
vi.mock('@/components/auth/PasswordVisibilityToggle', () => ({
  PasswordVisibilityToggle: () => null,
}));
vi.mock('@/components/BaciLogo', () => ({ BaciLogo: () => null }));
vi.mock('@/components/auth/login.styles', () => ({ styles: {} }));

// Mirrors AppFormScreen's default: the content scrolls unless told not to.
vi.mock('@/components/ui/AppFormScreen', async () => {
  const React = await import('react');
  return {
    AppFormScreen: ({
      children,
      scrollEnabled = true,
    }: {
      children?: ReactNode;
      scrollEnabled?: boolean;
    }) =>
      React.createElement(
        'div',
        { 'aria-label': scrollEnabled ? 'Scrolling form' : 'Fixed form' },
        children
      ),
  };
});

vi.mock('@/config/runtime-platform', () => ({
  isRuntimePlatform: () => true,
}));
vi.mock('@/context/OnboardingContext', () => ({
  useOnboarding: () => ({ resetOnboarding: vi.fn() }),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    activeAuthProvider: null,
    isAuthenticating: false,
    signIn: vi.fn(),
    signInWithApple: vi.fn(),
    signInWithGoogle: vi.fn(),
  }),
}));
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ colors: {}, isDark: false }),
}));
vi.mock('@/lib/sanitize', () => ({ getEmailError: () => null }));

import LoginScreen from './login';

describe('bugfix: login form jumped when switching fields with the keyboard open', () => {
  it('keeps the email and password fields in a scrolling form so a keyboard height change cannot re-centre them', () => {
    render(<LoginScreen />);

    const form = screen.getByLabelText('Scrolling form');
    expect(form.contains(screen.getByLabelText('Email'))).toBe(true);
    expect(form.contains(screen.getByLabelText('Password'))).toBe(true);
    expect(screen.queryByLabelText('Fixed form')).toBeNull();
  });
});
