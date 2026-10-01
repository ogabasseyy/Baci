import '@testing-library/jest-dom/vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { KeyboardEvent, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  back: vi.fn(),
  replace: vi.fn(),
  verifySignupOtp: vi.fn(),
  resend: vi.fn(),
  searchParams: {
    attemptId: '123e4567-e89b-42d3-a456-426614174000',
    email: 'merchant@example.com',
    flow: 'merchant',
  },
}));

interface TextInputProps {
  accessibilityLabel?: string;
  onChangeText?: (text: string) => void;
  onFocus?: () => void;
  onKeyPress?: (event: { nativeEvent: { key: string } }) => void;
  value?: string;
}

vi.mock('react-native', async () => {
  const React = await import('react');

  const TextInput = React.forwardRef<HTMLInputElement, TextInputProps>(
    ({ accessibilityLabel, onChangeText, onFocus, onKeyPress, value }, ref) => {
      return React.createElement('input', {
        'aria-label': accessibilityLabel,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          onChangeText?.(event.target.value),
        onFocus,
        onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
          onKeyPress?.({ nativeEvent: { key: event.key } });
        },
        ref,
        value: value ?? '',
      });
    }
  );
  TextInput.displayName = 'TextInputMock';

  return {
    ActivityIndicator: () => React.createElement('span', null, 'loading'),
    Alert: { alert: mocks.alert },
    Pressable: ({
      accessibilityLabel,
      children,
      disabled,
      onPress,
    }: {
      accessibilityLabel?: string;
      children?: ReactNode;
      disabled?: boolean;
      onPress?: () => void;
    }) =>
      React.createElement(
        'button',
        { 'aria-label': accessibilityLabel, disabled, onClick: onPress },
        children
      ),
    StatusBar: () => null,
    StyleSheet: {
      absoluteFill: {},
      create: (styles: Record<string, unknown>) => styles,
      hairlineWidth: 1,
    },
    Text: ({ children }: { children?: ReactNode }) =>
      React.createElement('span', null, children),
    TextInput,
    View: ({ children }: { children?: ReactNode }) =>
      React.createElement('div', null, children),
  };
});

vi.mock('react-native-safe-area-context', async () => {
  const React = await import('react');
  return {
    SafeAreaView: ({ children }: { children?: ReactNode }) =>
      React.createElement('div', null, children),
  };
});

vi.mock('expo-linear-gradient', async () => {
  const React = await import('react');
  return {
    LinearGradient: ({ children }: { children?: ReactNode }) =>
      React.createElement('div', null, children),
  };
});

vi.mock('@react-native-vector-icons/ionicons', async () => {
  const React = await import('react');
  return {
    Ionicons: ({ name }: { name: string }) =>
      React.createElement('span', null, name),
    __esModule: true,
    default: ({ name }: { name: string }) =>
      React.createElement('span', null, name),
  };
});

vi.mock('expo-router', async () => {
  const React = await import('react');
  return {
    Redirect: ({ href }: { href: string }) =>
      React.createElement('span', { 'data-href': href }, 'redirect'),
    useLocalSearchParams: () => mocks.searchParams,
    useRouter: () => ({
      back: mocks.back,
      replace: mocks.replace,
    }),
  };
});

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#ffffff',
      backgroundLight: '#f8fafc',
      border: '#d5d5d5',
      card: '#f5f5f5',
      inputBg: '#f8fafc',
      primary: '#2563eb',
      success: '#16a34a',
      text: '#111111',
      textMuted: '#666666',
      textOnPrimary: '#ffffff',
      textSecondary: '#555555',
    },
    isDark: false,
  }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      resend: mocks.resend,
    },
  },
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    verifySignupOtp: mocks.verifySignupOtp,
  }),
}));

import VerifyScreen from './verify';

function enterVerificationCode() {
  for (const [index, digit] of ['1', '2', '3', '4', '5', '6'].entries()) {
    fireEvent.change(screen.getByLabelText(`Digit ${index + 1} of 6`), {
      target: { value: digit },
    });
  }
}

describe('VerifyScreen OTP keyboard controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchParams.flow = 'merchant';
    mocks.verifySignupOtp.mockResolvedValue({
      error: null,
      sessionEstablished: true,
    });
    mocks.resend.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('labels every OTP digit and exposes cross-platform previous and next controls', () => {
    render(<VerifyScreen />);

    expect(screen.getByLabelText('Digit 1 of 6')).toBeInTheDocument();
    expect(screen.getByLabelText('Digit 6 of 6')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Previous code digit' })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Next code digit' })
    ).toBeInTheDocument();
  });

  it('advances OTP focus and submits with the Verify code control on the last digit', async () => {
    render(<VerifyScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'Next code digit' }));
    expect(screen.getByLabelText('Digit 2 of 6')).toHaveFocus();

    enterVerificationCode();

    expect(screen.getByLabelText('Digit 6 of 6')).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Verify code' }));

    await waitFor(() => {
      expect(mocks.verifySignupOtp).toHaveBeenCalledWith(
        'merchant@example.com',
        '123456',
        '123e4567-e89b-42d3-a456-426614174000',
        'merchant'
      );
    });
  });

  it('passes the staff flow from the route to signup verification', async () => {
    mocks.searchParams.flow = 'staff';
    render(<VerifyScreen />);

    enterVerificationCode();
    fireEvent.click(screen.getByRole('button', { name: 'Verify code' }));

    await waitFor(() => {
      expect(mocks.verifySignupOtp).toHaveBeenCalledWith(
        'merchant@example.com',
        '123456',
        '123e4567-e89b-42d3-a456-426614174000',
        'staff'
      );
    });
  });

  it('offers setup only after the exact verified session is committed, then replaces the route', async () => {
    const verification = Promise.withResolvers<{
      error: null;
      sessionEstablished: true;
    }>();
    mocks.verifySignupOtp.mockReturnValue(verification.promise);
    render(<VerifyScreen />);

    enterVerificationCode();
    fireEvent.click(screen.getByRole('button', { name: 'Verify Email' }));

    expect(screen.queryByRole('button', { name: 'Continue setup' })).toBeNull();
    expect(mocks.replace).not.toHaveBeenCalled();

    verification.resolve({ error: null, sessionEstablished: true });

    const continueButton = await screen.findByRole('button', {
      name: 'Continue setup',
    });
    expect(
      screen.queryByRole('button', { name: 'Enter Dashboard' })
    ).toBeNull();
    expect(mocks.replace).not.toHaveBeenCalled();

    fireEvent.click(continueButton);

    expect(mocks.replace).toHaveBeenCalledWith('/(auth)/complete-profile');
  });

  it('stays on verification when Supabase does not return a complete session', async () => {
    mocks.verifySignupOtp.mockResolvedValue({
      error:
        'Email verification did not finish. Request a new code and try again.',
    });
    render(<VerifyScreen />);

    enterVerificationCode();
    fireEvent.click(screen.getByRole('button', { name: 'Verify Email' }));

    await waitFor(() => {
      expect(mocks.alert).toHaveBeenCalledWith(
        'Verification Failed',
        'Email verification did not finish. Request a new code and try again.'
      );
    });
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Continue setup' })).toBeNull();
  });

  it('resends only a signup OTP and presents a stable rate-limit message', async () => {
    vi.useFakeTimers();
    mocks.resend.mockResolvedValue({
      error: new Error('For security purposes, wait 60 seconds'),
    });
    render(<VerifyScreen />);

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));
    });

    expect(mocks.resend).toHaveBeenCalledWith({
      email: 'merchant@example.com',
      type: 'signup',
    });
    expect(mocks.alert).toHaveBeenCalledWith(
      'Could Not Resend Code',
      'Please wait before requesting another code.'
    );
  });
});
