import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  replace: vi.fn(),
  rpc: vi.fn(),
  signUp: vi.fn(),
  getPendingStaffInviteToken: vi.fn(() => 'token-abc' as string | null),
}));

vi.mock('expo-router', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock('react-native', async () => {
  const React = await import('react');
  return {
    ActivityIndicator: () => React.createElement('span', null, 'loading'),
    Alert: { alert: (...args: unknown[]) => mocks.alert(...args) },
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
        {
          'aria-label': accessibilityLabel,
          disabled,
          onClick: () => onPress?.(),
          type: 'button',
        },
        children
      ),
    StatusBar: () => null,
    Text: ({ children }: { children?: ReactNode }) =>
      React.createElement('span', null, children),
    View: ({ children }: { children?: ReactNode }) =>
      React.createElement('div', null, children),
  };
});

vi.mock('@/components/auth/AuthInput', async () => {
  const React = await import('react');
  return {
    AuthInput: ({
      editable = true,
      label,
      onChangeText,
      value,
    }: {
      editable?: boolean;
      label: string;
      onChangeText: (t: string) => void;
      value: string;
    }) =>
      React.createElement('input', {
        'aria-label': label,
        onChange: (e: { target: { value: string } }) =>
          onChangeText(e.target.value),
        readOnly: !editable,
        value,
      }),
  };
});

vi.mock('@/components/auth/PasswordVisibilityToggle', () => ({
  PasswordVisibilityToggle: () => null,
}));

vi.mock('@/components/BaciLogo', () => ({ BaciLogo: () => null }));

vi.mock('@/components/ui/AppFormScreen', async () => {
  const React = await import('react');
  return {
    AppFormScreen: ({ children }: { children?: ReactNode }) =>
      React.createElement('div', null, children),
  };
});

vi.mock('@/components/auth/login.styles', () => ({ styles: {} }));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ colors: {}, isDark: false }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ signUp: mocks.signUp, isAuthenticating: false }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mocks.rpc(...args) },
}));

vi.mock('@/lib/staff-invite-pending', () => ({
  getPendingStaffInviteToken: () => mocks.getPendingStaffInviteToken(),
  buildStaffInviteRoute: (token: string) => `/invite/${token}`,
}));

import StaffSignupScreen from './staff-signup';

const STRONG_PASSWORD = 'Str0ng-Passw0rd!';

function fillValidCredentials() {
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: STRONG_PASSWORD },
  });
  fireEvent.change(screen.getByLabelText('Confirm password'), {
    target: { value: STRONG_PASSWORD },
  });
}

const submitButton = () =>
  screen.getByRole('button', {
    name: 'Create account and accept invitation',
  });

describe('StaffSignupScreen', () => {
  beforeEach(() => {
    mocks.alert.mockReset();
    mocks.replace.mockReset();
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({
      data: [{ email: 'invited@example.com', role: 'sales_rep' }],
      error: null,
    });
    mocks.signUp.mockReset();
    mocks.getPendingStaffInviteToken.mockReturnValue('token-abc');
  });

  it('pre-fills and locks the email from the invite preview', async () => {
    render(<StaffSignupScreen />);

    const emailInput = screen.getByLabelText('Email') as HTMLInputElement;
    await waitFor(() => {
      expect(emailInput.value).toBe('invited@example.com');
    });
    expect(emailInput).toHaveAttribute('readonly');
  });

  it('blocks account creation when the invite preview is invalid', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    render(<StaffSignupScreen />);

    await waitFor(() => {
      expect(screen.getByText(/invalid or has expired/i)).toBeInTheDocument();
    });
    expect(submitButton()).toBeDisabled();
    fillValidCredentials();
    submitButton().click();
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it('offers retry (not a terminal error) when the preview fails transiently', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'Network request failed' },
    });
    render(<StaffSignupScreen />);

    // A transient network failure must not be shown as "invalid/expired".
    const retry = await screen.findByRole('button', { name: 'Try again' });
    expect(
      screen.getByText(/couldn't verify this invitation/i)
    ).toBeInTheDocument();
    expect(mocks.signUp).not.toHaveBeenCalled();

    // Retrying re-runs the preview RPC.
    mocks.rpc.mockClear();
    retry.click();
    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalled();
    });
  });

  it('creates an account-only signup and routes to accept the invite on success', async () => {
    mocks.signUp.mockResolvedValue({ error: null });
    render(<StaffSignupScreen />);

    await waitFor(() => {
      expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe(
        'invited@example.com'
      );
    });
    fillValidCredentials();
    submitButton().click();

    await waitFor(() => {
      expect(mocks.signUp).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'invited@example.com',
          signupFlow: 'staff',
        })
      );
    });
    expect(mocks.replace).toHaveBeenCalledWith('/invite/token-abc');
  });

  it('routes existing accounts to sign-in instead of creating a store', async () => {
    mocks.signUp.mockResolvedValue({ error: null, accountExists: true });
    mocks.alert.mockImplementation(
      (
        _title: string,
        _msg: string,
        buttons?: Array<{ onPress?: () => void }>
      ) => buttons?.[0]?.onPress?.()
    );
    render(<StaffSignupScreen />);

    // Wait for the locked email to populate before submitting.
    await waitFor(() => {
      expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe(
        'invited@example.com'
      );
    });
    fillValidCredentials();
    submitButton().click();

    await waitFor(() => {
      expect(mocks.alert).toHaveBeenCalled();
    });
    expect(mocks.replace).toHaveBeenCalledWith('/(auth)/login');
    expect(mocks.replace).not.toHaveBeenCalledWith('/invite/token-abc');
  });
});
