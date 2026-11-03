import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  isIos: true,
  isKeyboardShown: false,
  scrollEnabled: undefined as boolean | undefined,
}));

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flattenStyle));
  }
  return style && typeof style === 'object'
    ? (style as Record<string, unknown>)
    : {};
}

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
    StyleSheet: { create: (styles: Record<string, unknown>) => styles },
    Text: ({ children }: { children?: ReactNode }) =>
      React.createElement('span', null, children),
    View: ({ children, style }: { children?: ReactNode; style?: unknown }) =>
      React.createElement(
        'div',
        { 'data-justify': flattenStyle(style).justifyContent },
        children
      ),
  };
});

vi.mock('react-native-safe-area-context', async () => {
  const React = await import('react');
  return {
    SafeAreaView: ({ children }: { children?: ReactNode }) =>
      React.createElement('div', null, children),
  };
});

// The real AppFormScreen runs; only the native keyboard container is
// replaced, so the test follows AppFormScreen's actual scroll default.
vi.mock('@/components/ui/AppKeyboardContainer', async () => {
  const React = await import('react');
  return {
    AppKeyboardContainer: ({
      children,
      scrollEnabled,
    }: {
      children?: ReactNode;
      scrollEnabled?: boolean;
    }) => {
      state.scrollEnabled = scrollEnabled;
      return React.createElement('section', null, children);
    },
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
vi.mock('@/config/runtime-platform', () => ({
  isRuntimePlatform: (platform: string) =>
    platform === (state.isIos ? 'ios' : 'android'),
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
vi.mock('@/hooks/useKeyboardShown', () => ({
  useKeyboardShown: () => state.isKeyboardShown,
}));
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ colors: {}, isDark: false }),
}));
vi.mock('@/lib/sanitize', () => ({ getEmailError: () => null }));

import LoginScreen from './login';

/** The container that lays out the branding and the form. */
function formLayout() {
  return screen
    .getByText('Baci')
    .closest('[data-justify="center"], [data-justify="flex-start"]');
}

describe('bugfix: login form jumped when switching fields with the keyboard open', () => {
  beforeEach(() => {
    state.isIos = true;
    state.isKeyboardShown = false;
    state.scrollEnabled = undefined;
  });

  it('lets the form scroll so a keyboard height change cannot re-centre a tall form', () => {
    render(<LoginScreen />);

    expect(state.scrollEnabled).toBe(true);
  });

  it('centres the form while the keyboard is hidden', () => {
    render(<LoginScreen />);

    expect(formLayout()?.getAttribute('data-justify')).toBe('center');
  });

  it('keeps the form at the top while the keyboard is up, so switching fields cannot move it', () => {
    state.isKeyboardShown = true;
    render(<LoginScreen />);

    expect(formLayout()?.getAttribute('data-justify')).toBe('flex-start');
  });

  it('keeps the form at the top through a field switch with the keyboard open', () => {
    const { rerender } = render(<LoginScreen />);
    expect(formLayout()?.getAttribute('data-justify')).toBe('center');

    // Focusing the email field opens the keyboard.
    state.isKeyboardShown = true;
    rerender(<LoginScreen />);
    expect(formLayout()?.getAttribute('data-justify')).toBe('flex-start');

    // Moving to the password field reports the keyboard again (its height
    // can change); the form must not move.
    rerender(<LoginScreen />);
    expect(formLayout()?.getAttribute('data-justify')).toBe('flex-start');
    expect(state.scrollEnabled).toBe(true);

    // Closing the keyboard re-centres the form.
    state.isKeyboardShown = false;
    rerender(<LoginScreen />);
    expect(formLayout()?.getAttribute('data-justify')).toBe('center');
  });

  it('leaves the Android layout centred, since Android reports the keyboard only after it has opened', () => {
    state.isIos = false;
    state.isKeyboardShown = true;
    render(<LoginScreen />);

    expect(formLayout()?.getAttribute('data-justify')).toBe('center');
    expect(state.scrollEnabled).toBe(true);
  });
});
