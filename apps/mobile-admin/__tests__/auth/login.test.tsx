import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_KEYBOARD_CONTAINER_LABEL } from './app-keyboard-container.mock';

const mocks = vi.hoisted(() => ({
  activeAuthProvider: null as 'password' | 'google' | 'apple' | null,
  push: vi.fn(),
  replace: vi.fn(),
  signIn: vi.fn(),
  signInWithApple: vi.fn(),
  signInWithGoogle: vi.fn(),
  isAuthenticating: false,
  resetOnboarding: vi.fn(),
  alert: vi.fn(),
}));

vi.mock('@/components/ui/AppFormScreen', async () => {
  const { createAppFormScreenMock } = await import('./app-form-screen.mock');
  return createAppFormScreenMock();
});

vi.mock('react-native', async () => {
  const React = await import('react');

  return {
    StatusBar: () => null,
    Alert: { alert: mocks.alert },
    ActivityIndicator: () => React.createElement('span', null, 'loading'),
    KeyboardAvoidingView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
    Platform: { OS: 'web' },
    Pressable: ({
      children,
      onPress,
      disabled,
      accessibilityLabel,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
    }) =>
      React.createElement(
        'button',
        { onClick: onPress, disabled, 'aria-label': accessibilityLabel },
        children
      ),
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
    },
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('span', null, children),
    TextInput: ({
      onChangeText,
      placeholder,
      value,
      secureTextEntry,
      editable = true,
    }: {
      onChangeText?: (text: string) => void;
      placeholder?: string;
      value?: string;
      secureTextEntry?: boolean;
      editable?: boolean;
    }) =>
      React.createElement('input', {
        placeholder,
        value: value ?? '',
        type: secureTextEntry ? 'password' : 'text',
        disabled: !editable,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          onChangeText?.(event.target.value),
      }),
    View: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  };
});

vi.mock('react-native-safe-area-context', async () => {
  const React = await import('react');

  return {
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  };
});

vi.mock('react-native-svg', async () => {
  const React = await import('react');

  return {
    __esModule: true,
    default: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('svg', null, children),
    Path: () => React.createElement('path'),
  };
});

vi.mock('@react-native-vector-icons/ionicons', async () => {
  const React = await import('react');

  return {
    Ionicons: ({ name }: { name: string }) =>
      React.createElement('span', null, name),

    default: ({ name }: { name: string }) =>
      React.createElement('span', null, name),
    __esModule: true,
  };
});

vi.mock('expo-router', () => ({
  useRouter: () => ({
    push: mocks.push,
    replace: mocks.replace,
  }),
}));

vi.mock('expo-apple-authentication', () => ({
  AppleAuthenticationScope: {
    FULL_NAME: 'FULL_NAME',
    EMAIL: 'EMAIL',
  },
  signInAsync: vi.fn(),
}));

vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: {
        googleIosClientId: 'ios-client-id',
        googleWebClientId: 'web-client-id',
      },
    },
  },
}));

vi.mock('@/components/ui/AppKeyboardContainer', async () => {
  const module = await import('./app-keyboard-container.mock');
  return module.createAppKeyboardContainerMock();
});

vi.mock('@/components/BaciLogo', async () => {
  const React = await import('react');
  return {
    BaciLogo: () => React.createElement('div', null, 'BaciLogo'),
  };
});

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#ffffff',
      card: '#f5f5f5',
      border: '#d5d5d5',
      text: '#111111',
      textMuted: '#666666',
      textSecondary: '#555555',
      error: '#b00020',
      errorLight: '#f9d7dc',
    },
  }),
}));

vi.mock('@/hooks/useKeyboardShown', () => ({
  useKeyboardShown: () => false,
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    activeAuthProvider: mocks.activeAuthProvider,
    isAuthenticating: mocks.isAuthenticating,
    signIn: mocks.signIn,
    signInWithApple: mocks.signInWithApple,
    signInWithGoogle: mocks.signInWithGoogle,
  }),
}));

vi.mock('@/context/OnboardingContext', () => ({
  useOnboarding: () => ({
    resetOnboarding: mocks.resetOnboarding,
  }),
}));

vi.mock('@/lib/sanitize', () => ({
  getEmailError: () => null,
}));

import LoginScreen from '../../app/(auth)/login';

function fillLoginFields() {
  fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
    target: { value: 'merchant@example.com' },
  });
  fireEvent.change(screen.getByPlaceholderText('••••••••'), {
    target: { value: 'StrongP@ss123!' },
  });
}

describe('LoginScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signIn.mockResolvedValue({ error: null });
    mocks.signInWithApple.mockResolvedValue({ error: null });
    mocks.signInWithGoogle.mockResolvedValue({ error: null });
    mocks.activeAuthProvider = null;
    mocks.isAuthenticating = false;
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the login keyboard container and sign-up prompt', () => {
    render(<LoginScreen />);

    expect(
      screen.getByRole('region', { name: APP_KEYBOARD_CONTAINER_LABEL })
    ).toBeTruthy();
    expect(screen.getByText("Don't have an account?")).toBeTruthy();
    expect(screen.getByText('Sign Up')).toBeTruthy();
  });

  it('navigates to register when Sign Up is pressed', () => {
    render(<LoginScreen />);

    fireEvent.click(screen.getByText('Sign Up'));

    expect(mocks.push).toHaveBeenCalledWith('/(auth)/register');
  });

  it('navigates to forgot password when Forgot Password is pressed', () => {
    render(<LoginScreen />);

    fireEvent.click(screen.getByText('Forgot Password?'));

    expect(mocks.push).toHaveBeenCalledWith('/(auth)/forgot-password');
  });

  it('disables the sign-up link while sign-in is in progress', async () => {
    let resolveSignIn:
      | ((value: { error: null } | PromiseLike<{ error: null }>) => void)
      | undefined;
    const signInPromise = new Promise<{ error: null }>((resolve) => {
      resolveSignIn = resolve;
    });
    mocks.signIn.mockReturnValue(signInPromise);

    const view = render(<LoginScreen />);
    fillLoginFields();
    fireEvent.click(screen.getByText('Sign In'));
    mocks.isAuthenticating = true;
    mocks.activeAuthProvider = 'password';
    view.rerender(<LoginScreen />);

    const signUpButton = screen.getByLabelText(
      'Sign up for a new merchant account'
    ) as HTMLButtonElement;

    await waitFor(() => {
      expect(signUpButton.disabled).toBe(true);
    });

    if (resolveSignIn) {
      resolveSignIn({ error: null });
    }
    mocks.isAuthenticating = false;
    mocks.activeAuthProvider = null;
    view.rerender(<LoginScreen />);
    await waitFor(() => {
      expect(signUpButton.disabled).toBe(false);
    });
  });

  it('shows the Google provider error when native sign-in fails', async () => {
    mocks.signInWithGoogle.mockResolvedValue({
      error: 'Google Sign-in is not available in this build.',
    });

    render(<LoginScreen />);

    fireEvent.click(screen.getByText('Google'));

    expect(mocks.signInWithGoogle).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText('Google Sign-in is not available in this build.')
    ).toBeTruthy();
  });

  it('disables auth links while Google sign-in is in progress and restores them after success', async () => {
    let resolveGoogleSignIn:
      | ((value: { error: null } | PromiseLike<{ error: null }>) => void)
      | undefined;
    const googleSignInPromise = new Promise<{ error: null }>((resolve) => {
      resolveGoogleSignIn = resolve;
    });
    mocks.signInWithGoogle
      .mockResolvedValueOnce({
        error: 'Google Sign-in is not available in this build.',
      })
      .mockReturnValueOnce(googleSignInPromise);

    const view = render(<LoginScreen />);
    fireEvent.click(screen.getByText('Google'));
    expect(
      await screen.findByText('Google Sign-in is not available in this build.')
    ).toBeTruthy();

    fireEvent.click(screen.getByText('Google'));
    mocks.isAuthenticating = true;
    mocks.activeAuthProvider = 'google';
    view.rerender(<LoginScreen />);

    const forgotPasswordButton = screen.getByLabelText(
      'Forgot password? Reset your password'
    ) as HTMLButtonElement;
    const signUpButton = screen.getByLabelText(
      'Sign up for a new merchant account'
    ) as HTMLButtonElement;

    await waitFor(() => {
      expect(forgotPasswordButton.disabled).toBe(true);
      expect(signUpButton.disabled).toBe(true);
      expect(
        screen.queryByText('Google Sign-in is not available in this build.')
      ).toBeNull();
    });

    fireEvent.click(forgotPasswordButton);
    expect(mocks.push).not.toHaveBeenCalledWith('/(auth)/forgot-password');

    if (resolveGoogleSignIn) {
      resolveGoogleSignIn({ error: null });
    }
    mocks.isAuthenticating = false;
    mocks.activeAuthProvider = null;
    view.rerender(<LoginScreen />);

    await waitFor(() => {
      expect(forgotPasswordButton.disabled).toBe(false);
      expect(signUpButton.disabled).toBe(false);
    });
  });
});
