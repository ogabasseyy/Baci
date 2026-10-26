import { fireEvent, render, screen } from '@testing-library/react-native';
import { type ComponentProps, createRef } from 'react';
import type { TextInput } from 'react-native';
import Colors from '@/constants/Colors';
import { LoginScreenContent } from './LoginScreenContent';

jest.mock('@/components/ui/Logo', () => ({ Logo: () => null }));
jest.mock('@/components/icons/GoogleLogo', () => ({ GoogleLogo: () => null }));
jest.mock('./LoginOtpStep', () => ({ LoginOtpStep: () => null }));

function createProps(): ComponentProps<typeof LoginScreenContent> {
  return {
    authMethod: 'otp',
    colors: Colors.light,
    email: 'shopper@example.com',
    emailError: null,
    colorScheme: 'light',
    dismissAndNavigate: jest.fn(),
    handleAppleSignIn: jest.fn(),
    handleContinue: jest.fn(),
    handleGoogleSignIn: jest.fn(),
    handlePasswordSignIn: jest.fn(),
    handleResendOtp: jest.fn(),
    isAppleLoading: false,
    isGoogleLoading: false,
    isLoading: false,
    isMountedRef: { current: true },
    isVerifyingRef: { current: false },
    otp: '',
    otpError: null,
    otpInputRef: createRef<TextInput>(),
    password: '',
    passwordError: null,
    setAuthMethod: jest.fn(),
    setEmail: jest.fn(),
    setEmailError: jest.fn(),
    setOtp: jest.fn(),
    setOtpError: jest.fn(),
    setPassword: jest.fn(),
    setPasswordError: jest.fn(),
    setShowPassword: jest.fn(),
    setStep: jest.fn(),
    showPassword: false,
    signInWithOtp: jest.fn(),
    step: 'email',
    verifyOtp: jest.fn(),
  };
}

it('opens the password field on the first password-mode tap without sending an OTP', () => {
  const props = createProps();
  const { rerender } = render(<LoginScreenContent {...props} />);
  fireEvent.press(screen.getByText('Use password instead'));
  expect(props.setStep).toHaveBeenCalledWith('password');
  expect(props.setAuthMethod).toHaveBeenCalledWith('password');
  expect(props.signInWithOtp).not.toHaveBeenCalled();
  expect(props.handleContinue).not.toHaveBeenCalled();
  rerender(
    <LoginScreenContent {...props} step="password" authMethod="password" />
  );
  expect(screen.getByPlaceholderText('••••••••')).toBeOnTheScreen();
  expect(screen.queryByText('Continue with Password')).toBeNull();
});

it('keeps invalid email editable instead of opening a password step with an invalid address', () => {
  const props = { ...createProps(), email: 'invalid' };
  render(<LoginScreenContent {...props} />);
  fireEvent.press(screen.getByText('Use password instead'));
  expect(props.setStep).not.toHaveBeenCalled();
  expect(props.setEmailError).toHaveBeenCalledWith(expect.any(String));
});
