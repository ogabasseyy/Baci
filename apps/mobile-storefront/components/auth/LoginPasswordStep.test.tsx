import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import type { TextInputInstance } from 'react-native';
import { Alert } from 'react-native';
import { LoginPasswordStep } from '@/components/auth/LoginPasswordStep';
import Colors from '@/constants/Colors';

type LoginPasswordStepProps = ComponentProps<typeof LoginPasswordStep>;

function makeProps(
  overrides: Partial<LoginPasswordStepProps> = {}
): LoginPasswordStepProps {
  return {
    colors: Colors.light,
    email: 'shopper@example.com',
    handlePasswordSignIn: jest.fn(),
    isLoading: false,
    otpInputRef: { current: null } as LoginPasswordStepProps['otpInputRef'],
    password: 'secret-password',
    passwordError: null,
    setAuthMethod: jest.fn(),
    setEmailError: jest.fn(),
    setPassword: jest.fn(),
    setPasswordError: jest.fn(),
    setStep: jest.fn(),
    showPassword: false,
    signInWithOtp: jest.fn().mockResolvedValue({ success: true }),
    toggleShowPassword: jest.fn(),
    ...overrides,
  };
}

describe('LoginPasswordStep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('renders password sign-in content and forwards sign-in actions', () => {
    const props = makeProps();

    render(<LoginPasswordStep {...props} />);

    expect(screen.getByText('Enter Password')).toBeOnTheScreen();
    expect(
      screen.getByText('Sign in with your password for shopper@example.com')
    ).toBeOnTheScreen();
    expect(screen.getByPlaceholderText('••••••••')).toBeOnTheScreen();

    fireEvent.press(screen.getByRole('button', { name: 'Sign In' }));
    fireEvent(screen.getByPlaceholderText('••••••••'), 'submitEditing');

    expect(props.handlePasswordSignIn).toHaveBeenCalledTimes(2);
  });

  it('updates password input and clears an existing password error', () => {
    const props = makeProps({ passwordError: 'Wrong password' });

    render(<LoginPasswordStep {...props} />);

    expect(screen.getByText('Wrong password')).toBeOnTheScreen();
    fireEvent.changeText(screen.getByPlaceholderText('••••••••'), 'updated');

    expect(props.setPassword).toHaveBeenCalledWith('updated');
    expect(props.setPasswordError).toHaveBeenCalledWith(null);
  });

  it('toggles password visibility through the icon button', () => {
    const props = makeProps();
    const { rerender } = render(<LoginPasswordStep {...props} />);

    expect(screen.getByPlaceholderText('••••••••').props.secureTextEntry).toBe(
      true
    );
    fireEvent.press(screen.getByRole('button', { name: 'Show password' }));
    expect(props.toggleShowPassword).toHaveBeenCalledTimes(1);

    rerender(<LoginPasswordStep {...props} showPassword />);

    expect(screen.getByPlaceholderText('••••••••').props.secureTextEntry).toBe(
      false
    );
    expect(
      screen.getByRole('button', { name: 'Hide password' })
    ).toBeOnTheScreen();
  });

  it('switches to OTP when the email is valid and focuses the OTP input', async () => {
    jest.useFakeTimers();
    const focus = jest.fn();
    const props = makeProps({
      otpInputRef: {
        current: { focus } as unknown as TextInputInstance,
      } as LoginPasswordStepProps['otpInputRef'],
    });

    render(<LoginPasswordStep {...props} />);

    fireEvent.press(screen.getByText('Sign in with verification code instead'));

    expect(props.setAuthMethod).toHaveBeenCalledWith('otp');
    await waitFor(() => {
      expect(props.signInWithOtp).toHaveBeenCalledWith('shopper@example.com');
      expect(props.setStep).toHaveBeenCalledWith('otp');
    });
    jest.runOnlyPendingTimers();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('returns to email step when switching to OTP with an invalid email', () => {
    const props = makeProps({ email: 'not-an-email' });

    render(<LoginPasswordStep {...props} />);

    fireEvent.press(screen.getByText('Sign in with verification code instead'));

    expect(props.setAuthMethod).toHaveBeenCalledWith('otp');
    expect(props.setEmailError).toHaveBeenCalledWith(expect.any(String));
    expect(props.setStep).toHaveBeenCalledWith('email');
    expect(props.signInWithOtp).not.toHaveBeenCalled();
  });

  it('alerts and returns to email step when OTP fallback sending fails', async () => {
    const props = makeProps({
      signInWithOtp: jest.fn().mockResolvedValue({
        error: 'Could not send code',
        success: false,
      }),
    });

    render(<LoginPasswordStep {...props} />);

    fireEvent.press(screen.getByText('Sign in with verification code instead'));

    await waitFor(() => {
      expect(props.setStep).toHaveBeenCalledWith('email');
      expect(Alert.alert).toHaveBeenCalledWith('Error', 'Could not send code');
    });
  });

  it('marks the sign-in button disabled and busy while loading', () => {
    render(<LoginPasswordStep {...makeProps({ isLoading: true })} />);

    expect(
      screen.getByRole('button', {
        name: 'Signing in',
        disabled: true,
        busy: true,
      })
    ).toBeDisabled();
  });
});
