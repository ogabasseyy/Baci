import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { getCheckoutIdentityTheme } from '../colors';
import { SocialCheckoutButtons } from './SocialCheckoutButtons';

function renderButtons(isLoading = false) {
  const onAppleSignIn = jest.fn();
  const onGoogleSignIn = jest.fn();
  const view = render(
    <SocialCheckoutButtons
      isLoading={isLoading}
      onAppleSignIn={onAppleSignIn}
      onGoogleSignIn={onGoogleSignIn}
      theme={getCheckoutIdentityTheme('light')}
    />
  );
  return { ...view, onAppleSignIn, onGoogleSignIn };
}

it('shows Apple and Google actions on iOS and calls their handlers', () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  try {
    const { onAppleSignIn, onGoogleSignIn } = renderButtons();
    fireEvent.press(
      screen.getByRole('button', { name: 'Continue with Apple' })
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Sign in with Google' })
    );

    expect(onAppleSignIn).toHaveBeenCalledTimes(1);
    expect(onGoogleSignIn).toHaveBeenCalledTimes(1);
  } finally {
    jest.restoreAllMocks();
  }
});

it('shows Google only on Android', () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  try {
    renderButtons();

    expect(
      screen.queryByRole('button', { name: 'Continue with Apple' })
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Sign in with Google' })
    ).toBeTruthy();
  } finally {
    jest.restoreAllMocks();
  }
});

it('disables supported social actions while authentication is busy', () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  try {
    renderButtons(true);

    expect(
      screen.getByRole('button', { name: 'Continue with Apple' })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Sign in with Google' })
    ).toBeDisabled();
  } finally {
    jest.restoreAllMocks();
  }
});
