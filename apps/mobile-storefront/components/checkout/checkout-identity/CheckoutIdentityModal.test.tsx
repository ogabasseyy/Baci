import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { CheckoutIdentityModal } from './CheckoutIdentityModal';
import { getCheckoutIdentityTheme } from './colors';

const mockSendCode = jest.fn();
const mockVerifyCode = jest.fn();
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (select: (state: unknown) => unknown) =>
    select({ signInWithOtp: mockSendCode, verifyOtp: mockVerifyCode }),
}));
jest.mock('./hooks', () => ({
  useBottomSheetAnimation: () => ({}),
  useHapticFeedback: () => ({ triggerHaptic: jest.fn() }),
  useSignInForm: () => ({}),
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
  mockSendCode.mockResolvedValue({ success: true });
  mockVerifyCode.mockResolvedValue({ success: true });
});

it('offers email-code sign-in immediately and opens checkout after verification', async () => {
  const close = jest.fn();
  render(<CheckoutIdentityModal isOpen onClose={close} />);

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
  expect(router.replace).toHaveBeenCalledWith('/checkout');
});

it('keeps guest checkout available when the code cannot be sent', async () => {
  mockSendCode.mockResolvedValue({ success: false, error: 'Try again later.' });
  const close = jest.fn();
  render(<CheckoutIdentityModal isOpen onClose={close} />);
  fireEvent.changeText(
    screen.getByLabelText('Email address'),
    'shopper@example.com'
  );
  fireEvent.press(screen.getByRole('button', { name: 'Continue with email' }));
  expect(await screen.findByText('Try again later.')).toBeTruthy();

  fireEvent.press(screen.getByRole('button', { name: 'Continue as Guest' }));
  expect(close).toHaveBeenCalledTimes(1);
  expect(router.push).toHaveBeenCalledWith('/checkout');
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
  fireEvent.changeText(email, 'shopper@example.com');
  expect(button).toBeEnabled();
  fireEvent.changeText(email, 'shopper@');
  expect(button).toBeDisabled();
});

async function enterVerificationCode() {
  fireEvent.changeText(
    screen.getByLabelText('Email address'),
    'shopper@example.com'
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
  expect(router.replace).not.toHaveBeenCalled();

  fireEvent.changeText(screen.getByLabelText('Verification code'), '654321');
  fireEvent.press(
    screen.getByRole('button', { name: 'Verify & continue checkout' })
  );
  await screen.findByRole('button', { name: 'Verify & continue checkout' });
  expect(mockVerifyCode).toHaveBeenLastCalledWith(
    'shopper@example.com',
    '654321'
  );
  expect(close).toHaveBeenCalledTimes(1);
  expect(router.replace).toHaveBeenCalledWith('/checkout');
});

it('ignores verification completion after the shopper closes the sheet', async () => {
  let complete = (_result: { success: boolean }) => {};
  mockVerifyCode.mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve;
    })
  );
  const close = jest.fn();
  const { rerender } = render(<CheckoutIdentityModal isOpen onClose={close} />);

  fireEvent.press(await enterVerificationCode());
  fireEvent.press(screen.getByRole('button', { name: 'Close' }));
  rerender(<CheckoutIdentityModal isOpen={false} onClose={close} />);
  await act(async () => complete({ success: true }));

  expect(close).toHaveBeenCalledTimes(1);
  expect(router.replace).not.toHaveBeenCalled();
});

it('allows a code resend only after the cooldown and restarts the cooldown on success', async () => {
  jest.useFakeTimers();
  try {
    render(<CheckoutIdentityModal isOpen onClose={jest.fn()} />);
    await enterVerificationCode();
    expect(
      screen.getByRole('button', {
        name: 'You can resend a code after 60 seconds.',
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
        name: 'You can resend a code after 60 seconds.',
      })
    ).toBeDisabled();
  } finally {
    jest.useRealTimers();
  }
});
