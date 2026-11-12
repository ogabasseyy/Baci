import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { CheckoutIdentityModal } from './CheckoutIdentityModal';
import { getCheckoutIdentityTheme } from './colors';

const mockSendCode = jest.fn();
const mockVerifyCode = jest.fn();
let mockSocialBusy = false;
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (select: (state: unknown) => unknown) =>
    select({ signInWithOtp: mockSendCode, verifyOtp: mockVerifyCode }),
}));
jest.mock('./hooks', () => ({
  useBottomSheetAnimation: () => ({}),
  useHapticFeedback: () => ({ triggerHaptic: jest.fn() }),
  useSignInForm: () => ({ isLoading: mockSocialBusy }),
}));
jest.mock('@/components/ui/AppKeyboardContainer', () => ({
  __esModule: true,
  default: require('react-native').View,
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSocialBusy = false;
  mockSendCode.mockResolvedValue({ success: true });
  mockVerifyCode.mockResolvedValue({ success: true });
});

let verificationEmail = '';
let emailCounter = 0;

it('offers email-code sign-in immediately and opens checkout after verification', async () => {
  const close = jest.fn();
  const onVerified = jest.fn();
  render(
    <CheckoutIdentityModal isOpen onClose={close} onVerified={onVerified} />
  );

  expect(
    screen.getByRole('header', { name: 'Let’s get you started' })
  ).toBeTruthy();
  fireEvent.changeText(
    screen.getByLabelText('Email address'),
    ' Shopper@Example.com '
  );
  fireEvent.press(screen.getByRole('button', { name: 'Continue with email' }));
  const code = await screen.findByLabelText('Verification code');
  expect(mockSendCode).toHaveBeenCalledWith('shopper@example.com');
  expect(
    screen.queryByRole('button', { name: 'Sign in with Google' })
  ).toBeNull();

  fireEvent.changeText(code, '123456');
  fireEvent.press(
    screen.getByRole('button', { name: 'Verify & continue checkout' })
  );
  await screen.findByRole('button', { name: 'Verify & continue checkout' });
  expect(mockVerifyCode).toHaveBeenCalledWith('shopper@example.com', '123456');
  expect(close).toHaveBeenCalledTimes(1);
  expect(onVerified).toHaveBeenCalledTimes(1);
  expect(router.push).not.toHaveBeenCalled();
});

it('keeps guest checkout available when the code cannot be sent', async () => {
  mockSendCode.mockResolvedValue({ success: false, error: 'Try again later.' });
  const close = jest.fn();
  render(<CheckoutIdentityModal isOpen onClose={close} />);
  fireEvent.changeText(
    screen.getByLabelText('Email address'),
    'guest-failure@example.com'
  );
  fireEvent.press(screen.getByRole('button', { name: 'Continue with email' }));
  expect(await screen.findByText('Try again later.')).toBeTruthy();

  fireEvent.press(screen.getByRole('button', { name: 'Continue as Guest' }));
  expect(close).toHaveBeenCalledTimes(1);
  expect(router.push).toHaveBeenCalledWith('/checkout');
});

it('blocks guest checkout while social sign-in is pending', () => {
  mockSocialBusy = true;
  const close = jest.fn();
  render(<CheckoutIdentityModal isOpen onClose={close} />);
  const guest = screen.getByRole('button', { name: 'Continue as Guest' });

  expect(guest).toBeDisabled();
  fireEvent.press(guest);
  expect(close).not.toHaveBeenCalled();
  expect(router.push).not.toHaveBeenCalled();
});

it('highlights the email field and enables email sign-in only for a complete address', () => {
  render(<CheckoutIdentityModal isOpen onClose={jest.fn()} />);
  const email = screen.getByLabelText('Email address');
  const button = screen.getByRole('button', { name: 'Continue with email' });

  expect(email).toHaveStyle({
    borderColor: getCheckoutIdentityTheme('light').error,
  });
  expect(button).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Sign in with Google' })
  ).toBeEnabled();
  expect(screen.getByText('Sign in with Google')).toBeTruthy();
  expect(screen.getByText('or')).toBeTruthy();
  fireEvent.changeText(email, 'shopper@example');
  expect(button).toBeDisabled();
  fireEvent(email, 'submitEditing');
  expect(mockSendCode).not.toHaveBeenCalled();
  fireEvent.changeText(email, 'complete-address@example.com');
  expect(button).toBeEnabled();
  fireEvent.changeText(email, 'shopper@');
  expect(button).toBeDisabled();
});

async function enterVerificationCode() {
  verificationEmail = `shopper-${++emailCounter}@example.com`;
  fireEvent.changeText(
    screen.getByLabelText('Email address'),
    verificationEmail
  );
  fireEvent.press(screen.getByRole('button', { name: 'Continue with email' }));
  const code = await screen.findByLabelText('Verification code');
  fireEvent.changeText(code, '123456');
  return screen.getByRole('button', { name: 'Verify & continue checkout' });
}

it('offers a retry after an incorrect verification code', async () => {
  mockVerifyCode.mockResolvedValueOnce({
    success: false,
    error: 'Incorrect code.',
  });
  const close = jest.fn();
  render(<CheckoutIdentityModal isOpen onClose={close} />);

  fireEvent.press(await enterVerificationCode());
  expect(await screen.findByText('Incorrect code.')).toBeTruthy();
  expect(router.push).not.toHaveBeenCalled();

  fireEvent.changeText(screen.getByLabelText('Verification code'), '654321');
  fireEvent.press(
    screen.getByRole('button', { name: 'Verify & continue checkout' })
  );
  await screen.findByRole('button', { name: 'Verify & continue checkout' });
  expect(mockVerifyCode).toHaveBeenLastCalledWith(verificationEmail, '654321');
  expect(close).toHaveBeenCalledTimes(1);
  expect(router.push).toHaveBeenCalledWith('/checkout');
});

it('keeps the sheet open until a pending OTP verification settles', async () => {
  let complete = (_result: { success: boolean }) => {};
  mockVerifyCode.mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve;
    })
  );
  const close = jest.fn();
  render(<CheckoutIdentityModal isOpen onClose={close} />);

  fireEvent.press(await enterVerificationCode());
  const closeButton = screen.getByRole('button', { name: 'Close' });
  expect(closeButton).toBeDisabled();
  expect(close).not.toHaveBeenCalled();
  await act(async () => complete({ success: true }));

  expect(close).toHaveBeenCalledTimes(1);
  expect(router.push).toHaveBeenCalledWith('/checkout');
});

it('prevents guest checkout while OTP verification is changing the session', async () => {
  let complete = (_result: { success: boolean }) => {};
  mockVerifyCode.mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve;
    })
  );
  const close = jest.fn();
  render(<CheckoutIdentityModal isOpen onClose={close} />);

  fireEvent.press(await enterVerificationCode());
  const guest = screen.getByRole('button', { name: 'Continue as Guest' });
  expect(guest).toBeDisabled();
  fireEvent.press(guest);
  expect(close).not.toHaveBeenCalled();
  expect(router.push).not.toHaveBeenCalled();

  await act(async () => complete({ success: true }));
  expect(close).toHaveBeenCalledTimes(1);
});

it('delegates guest checkout to the cart revalidation callback', async () => {
  const close = jest.fn();
  const onGuestCheckout = jest.fn();
  render(
    <CheckoutIdentityModal
      isOpen
      onClose={close}
      onGuestCheckout={onGuestCheckout}
    />
  );

  fireEvent.press(screen.getByRole('button', { name: 'Continue as Guest' }));

  expect(close).toHaveBeenCalledTimes(1);
  expect(onGuestCheckout).toHaveBeenCalledTimes(1);
  expect(router.push).not.toHaveBeenCalled();
});

it('allows a code resend only after the cooldown and restarts the cooldown on success', async () => {
  jest.useFakeTimers();
  try {
    render(<CheckoutIdentityModal isOpen onClose={jest.fn()} />);
    await enterVerificationCode();
    expect(
      screen.getByRole('button', {
        name: 'Resend code unavailable.',
      })
    ).toBeDisabled();

    act(() => jest.advanceTimersByTime(60_000));
    expect(screen.getByRole('button', { name: 'Resend code' })).toBeEnabled();
    await act(async () =>
      fireEvent.press(screen.getByRole('button', { name: 'Resend code' }))
    );
    expect(mockSendCode).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole('button', {
        name: 'Resend code unavailable.',
      })
    ).toBeDisabled();
  } finally {
    jest.useRealTimers();
  }
});

it('resumes the existing code and keeps resend disabled after switching email modes', async () => {
  jest.useFakeTimers();
  try {
    render(<CheckoutIdentityModal isOpen onClose={jest.fn()} />);
    fireEvent.changeText(
      screen.getByLabelText('Email address'),
      'cooldown-modal@example.com'
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Continue with email' })
    );
    await screen.findByLabelText('Verification code');

    fireEvent.press(
      screen.getByRole('button', { name: 'Use a different email' })
    );
    const email = screen.getByLabelText('Email address');
    fireEvent.changeText(email, ' Cooldown-Modal@Example.com ');
    const resumeButton = screen.getByRole('button', {
      name: 'Enter verification code',
    });

    expect(resumeButton).toBeEnabled();
    fireEvent.press(resumeButton);
    expect(await screen.findByLabelText('Verification code')).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Resend code unavailable.',
      })
    ).toBeDisabled();
    expect(mockSendCode).toHaveBeenCalledTimes(1);

    act(() => jest.advanceTimersByTime(60_000));
    const resendButton = screen.getByRole('button', { name: 'Resend code' });
    expect(resendButton).toBeEnabled();
    await act(async () => fireEvent.press(resendButton));
    expect(mockSendCode).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});

it('resumes the existing code when the shopper closes and reopens the sheet', async () => {
  jest.useFakeTimers();
  try {
    const emailAddress = 'reopen-modal@example.com';
    const { rerender } = render(
      <CheckoutIdentityModal isOpen onClose={jest.fn()} />
    );
    fireEvent.changeText(screen.getByLabelText('Email address'), emailAddress);
    fireEvent.press(
      screen.getByRole('button', { name: 'Continue with email' })
    );
    await screen.findByLabelText('Verification code');

    rerender(<CheckoutIdentityModal isOpen={false} onClose={jest.fn()} />);
    rerender(<CheckoutIdentityModal isOpen onClose={jest.fn()} />);
    fireEvent.changeText(screen.getByLabelText('Email address'), emailAddress);

    const resumeButton = screen.getByRole('button', {
      name: 'Enter verification code',
    });
    expect(resumeButton).toBeEnabled();
    fireEvent.press(resumeButton);
    expect(await screen.findByLabelText('Verification code')).toBeTruthy();
    expect(mockSendCode).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});
