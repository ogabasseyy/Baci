import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { LoginEmailStep } from '@/components/auth/LoginEmailStep';
import {
  PRIVACY_POLICY_URL,
  TERMS_OF_SERVICE_URL,
} from '@/components/settings/constants';
import Colors from '@/constants/Colors';

jest.mock('@/components/icons/GoogleLogo', () => ({
  GoogleLogo: () => null,
}));

describe('LoginEmailStep', () => {
  const onAppleSignIn = jest.fn();
  const onContinue = jest.fn();
  const onEmailChange = jest.fn();
  const onGoogleSignIn = jest.fn();
  const onToggleAuthMethod = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  });

  it('renders code sign-in choices and forwards each action', () => {
    render(
      <LoginEmailStep
        authMethod="otp"
        colors={Colors.light}
        email=""
        emailError={null}
        isAppleLoading={false}
        isGoogleLoading={false}
        isLoading={false}
        onAppleSignIn={onAppleSignIn}
        onContinue={onContinue}
        onEmailChange={onEmailChange}
        onGoogleSignIn={onGoogleSignIn}
        onToggleAuthMethod={onToggleAuthMethod}
      />
    );

    fireEvent.changeText(
      screen.getByPlaceholderText('john@example.com'),
      'shopper@example.com'
    );
    fireEvent.press(screen.getByText('Continue with Code'));
    fireEvent.press(screen.getByText('Use password instead'));
    fireEvent.press(screen.getByText('Google'));
    fireEvent.press(screen.getByText('Apple'));
    fireEvent.press(
      screen.getByRole('link', { name: 'Open terms of service' })
    );
    fireEvent.press(screen.getByRole('link', { name: 'Open privacy policy' }));

    expect(onEmailChange).toHaveBeenCalledWith('shopper@example.com');
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onToggleAuthMethod).toHaveBeenCalledTimes(1);
    expect(onGoogleSignIn).toHaveBeenCalledTimes(1);
    expect(onAppleSignIn).toHaveBeenCalledTimes(1);
    expect(Linking.openURL).toHaveBeenCalledWith(TERMS_OF_SERVICE_URL);
    expect(Linking.openURL).toHaveBeenCalledWith(PRIVACY_POLICY_URL);
  });

  it('shows masked receipt guidance without prefilling the input', () => {
    const { rerender } = render(
      <LoginEmailStep
        authMethod="otp"
        colors={Colors.light}
        email=""
        emailError={null}
        emailHintGuidance="S***@example.com"
        isAppleLoading={false}
        isGoogleLoading={false}
        isLoading={false}
        onAppleSignIn={onAppleSignIn}
        onContinue={onContinue}
        onEmailChange={onEmailChange}
        onGoogleSignIn={onGoogleSignIn}
        onToggleAuthMethod={onToggleAuthMethod}
      />
    );

    expect(
      screen.getByText(
        'This receipt was sent to S***@example.com — sign in with that address.'
      )
    ).toBeTruthy();
    expect(screen.getByPlaceholderText('john@example.com').props.value).toBe(
      ''
    );

    rerender(
      <LoginEmailStep
        authMethod="otp"
        colors={Colors.light}
        email=""
        emailError={null}
        isAppleLoading={false}
        isGoogleLoading={false}
        isLoading={false}
        onAppleSignIn={onAppleSignIn}
        onContinue={onContinue}
        onEmailChange={onEmailChange}
        onGoogleSignIn={onGoogleSignIn}
        onToggleAuthMethod={onToggleAuthMethod}
      />
    );
    expect(screen.queryByText(/This receipt was sent to/)).toBeNull();
  });

  it('shows validation feedback and the password continuation label', () => {
    render(
      <LoginEmailStep
        authMethod="password"
        colors={Colors.light}
        email="invalid-email"
        emailError="Enter a valid email address"
        isAppleLoading={false}
        isGoogleLoading={false}
        isLoading={false}
        onAppleSignIn={onAppleSignIn}
        onContinue={onContinue}
        onEmailChange={onEmailChange}
        onGoogleSignIn={onGoogleSignIn}
        onToggleAuthMethod={onToggleAuthMethod}
      />
    );

    expect(screen.getByText('Enter a valid email address')).toBeOnTheScreen();
    expect(screen.getByText('Continue with Password')).toBeOnTheScreen();
    expect(screen.getByText('Use verification code instead')).toBeOnTheScreen();
  });

  it('disables primary continuation and shows progress while auth is loading', () => {
    render(
      <LoginEmailStep
        authMethod="otp"
        colors={Colors.light}
        email="shopper@example.com"
        emailError={null}
        isAppleLoading={false}
        isGoogleLoading={false}
        isLoading
        onAppleSignIn={onAppleSignIn}
        onContinue={onContinue}
        onEmailChange={onEmailChange}
        onGoogleSignIn={onGoogleSignIn}
        onToggleAuthMethod={onToggleAuthMethod}
      />
    );

    expect(
      screen.getByRole('button', {
        name: 'Continue with Code',
        disabled: true,
        busy: true,
      })
    ).toBeDisabled();
    expect(screen.getByLabelText('Signing in')).toBeOnTheScreen();
    expect(screen.queryByText('Continue with Code')).toBeNull();
  });

  it('disables all auth actions while one social provider is signing in', () => {
    const { rerender } = render(
      <LoginEmailStep
        authMethod="otp"
        colors={Colors.light}
        email="shopper@example.com"
        emailError={null}
        isAppleLoading={false}
        isGoogleLoading
        isLoading={false}
        onAppleSignIn={onAppleSignIn}
        onContinue={onContinue}
        onEmailChange={onEmailChange}
        onGoogleSignIn={onGoogleSignIn}
        onToggleAuthMethod={onToggleAuthMethod}
      />
    );

    expect(
      screen.getByRole('button', {
        name: 'Continue with Code',
        disabled: true,
        busy: false,
      })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', {
        name: 'Continue with Google',
        disabled: true,
        busy: true,
      })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', {
        name: 'Continue with Apple',
        disabled: true,
        busy: false,
      })
    ).toBeDisabled();
    expect(screen.getByLabelText('Signing in with Google')).toBeOnTheScreen();

    rerender(
      <LoginEmailStep
        authMethod="otp"
        colors={Colors.light}
        email="shopper@example.com"
        emailError={null}
        isAppleLoading
        isGoogleLoading={false}
        isLoading={false}
        onAppleSignIn={onAppleSignIn}
        onContinue={onContinue}
        onEmailChange={onEmailChange}
        onGoogleSignIn={onGoogleSignIn}
        onToggleAuthMethod={onToggleAuthMethod}
      />
    );

    expect(
      screen.getByRole('button', {
        name: 'Continue with Code',
        disabled: true,
        busy: false,
      })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', {
        name: 'Continue with Google',
        disabled: true,
        busy: false,
      })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', {
        name: 'Continue with Apple',
        disabled: true,
        busy: true,
      })
    ).toBeDisabled();
    expect(screen.getByLabelText('Signing in with Apple')).toBeOnTheScreen();
  });
});
