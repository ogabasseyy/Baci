import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { getCheckoutIdentityTheme } from '../colors';
import { CheckoutCodeForm } from './CheckoutCodeForm';

const mockSendCode = jest.fn();
const mockVerifyCode = jest.fn();
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (select: (state: unknown) => unknown) =>
    select({ signInWithOtp: mockSendCode, verifyOtp: mockVerifyCode }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSendCode.mockResolvedValue({ success: true });
  mockVerifyCode.mockResolvedValue({ success: true });
});

function renderForm() {
  const onVerified = jest.fn();
  const onBusyChange = jest.fn();
  const onVerificationBusyChange = jest.fn();
  const result = render(
    <CheckoutCodeForm
      onVerified={onVerified}
      onBusyChange={onBusyChange}
      onVerificationBusyChange={onVerificationBusyChange}
      renderSocial={() => <Text>Social sign-in</Text>}
      socialBusy={false}
      theme={getCheckoutIdentityTheme('light')}
    />
  );
  return { ...result, onVerified, onBusyChange, onVerificationBusyChange };
}

it('sends a normalized address, announces busy state, then verifies the code', async () => {
  const { onVerified, onBusyChange, onVerificationBusyChange } = renderForm();
  fireEvent.changeText(
    screen.getByLabelText('Email address'),
    ' Shopper@Example.com '
  );
  fireEvent.press(screen.getByRole('button', { name: 'Continue with email' }));
  const code = await screen.findByLabelText('Verification code');

  expect(mockSendCode).toHaveBeenCalledWith('shopper@example.com');
  expect(onBusyChange).toHaveBeenNthCalledWith(1, true);
  expect(onBusyChange).toHaveBeenNthCalledWith(2, false);

  fireEvent.changeText(code, '123456');
  fireEvent.press(
    screen.getByRole('button', { name: 'Verify & continue checkout' })
  );
  await act(async () => {
    await Promise.resolve();
  });

  expect(mockVerifyCode).toHaveBeenCalledWith('shopper@example.com', '123456');
  expect(onVerified).toHaveBeenCalledTimes(1);
  expect(onBusyChange).toHaveBeenNthCalledWith(3, true);
  expect(onBusyChange).toHaveBeenNthCalledWith(4, false);
  expect(onVerificationBusyChange).toHaveBeenNthCalledWith(1, true);
  expect(onVerificationBusyChange).toHaveBeenNthCalledWith(2, false);
});

it('resumes verification and preserves resend cooldown after switching email', async () => {
  jest.useFakeTimers();
  try {
    renderForm();
    fireEvent.changeText(
      screen.getByLabelText('Email address'),
      'cooldown-form@example.com'
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Continue with email' })
    );
    await screen.findByLabelText('Verification code');

    fireEvent.press(
      screen.getByRole('button', { name: 'Use a different email' })
    );
    fireEvent.changeText(
      screen.getByLabelText('Email address'),
      ' Cooldown-Form@Example.com '
    );
    const resume = screen.getByRole('button', {
      name: 'Enter verification code',
    });
    expect(resume).toBeEnabled();
    fireEvent.press(resume);
    expect(await screen.findByLabelText('Verification code')).toBeTruthy();

    const resend = screen.getByRole('button', {
      name: 'Resend code unavailable.',
    });
    expect(resend).toBeDisabled();
    fireEvent.press(resend);
    expect(mockSendCode).toHaveBeenCalledTimes(1);

    act(() => jest.advanceTimersByTime(60_000));
    const availableResend = screen.getByRole('button', {
      name: 'Resend code',
    });
    expect(availableResend).toBeEnabled();
    await act(async () => fireEvent.press(availableResend));
    expect(mockSendCode).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});

it('does not update busy state after an in-flight request is unmounted', async () => {
  let complete!: (result: { success: boolean }) => void;
  mockSendCode.mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve;
    })
  );
  const { unmount, onBusyChange } = renderForm();
  fireEvent.changeText(
    screen.getByLabelText('Email address'),
    'unmount-form@example.com'
  );
  fireEvent.press(screen.getByRole('button', { name: 'Continue with email' }));
  expect(onBusyChange).toHaveBeenCalledWith(true);
  unmount();

  await act(async () => complete({ success: true }));
  expect(onBusyChange).toHaveBeenCalledTimes(1);

  const reopened = renderForm();
  fireEvent.changeText(
    screen.getByLabelText('Email address'),
    'unmount-form@example.com'
  );
  fireEvent.press(
    screen.getByRole('button', { name: 'Enter verification code' })
  );
  const code = await screen.findByLabelText('Verification code');
  expect(mockSendCode).toHaveBeenCalledTimes(1);
  fireEvent.changeText(code, '123456');
  fireEvent.press(
    screen.getByRole('button', { name: 'Verify & continue checkout' })
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(mockVerifyCode).toHaveBeenCalledWith(
    'unmount-form@example.com',
    '123456'
  );
  expect(reopened.onVerified).toHaveBeenCalledTimes(1);
});

it('joins an in-flight send after closing and reopening the form', async () => {
  let complete!: (result: { success: boolean }) => void;
  mockSendCode.mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve;
    })
  );
  const first = renderForm();
  fireEvent.changeText(
    screen.getByLabelText('Email address'),
    'inflight-form@example.com'
  );
  fireEvent.press(screen.getByRole('button', { name: 'Continue with email' }));
  expect(mockSendCode).toHaveBeenCalledTimes(1);
  first.unmount();

  renderForm();
  fireEvent.changeText(
    screen.getByLabelText('Email address'),
    'inflight-form@example.com'
  );
  expect(screen.getByRole('button', { name: 'Sending code…' })).toBeDisabled();

  await act(async () => complete({ success: true }));

  expect(await screen.findByLabelText('Verification code')).toBeTruthy();
  expect(mockSendCode).toHaveBeenCalledTimes(1);
});

it('does not start a second send for the same email while the first is pending', async () => {
  let complete!: (result: { success: boolean }) => void;
  mockSendCode.mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve;
    })
  );
  const first = renderForm();
  fireEvent.changeText(
    screen.getByLabelText('Email address'),
    'concurrent-form@example.com'
  );
  fireEvent.press(screen.getByRole('button', { name: 'Continue with email' }));
  first.unmount();

  const reopened = renderForm();
  fireEvent.changeText(
    screen.getByLabelText('Email address'),
    'concurrent-form@example.com'
  );
  expect(screen.getByRole('button', { name: 'Sending code…' })).toBeDisabled();
  expect(mockSendCode).toHaveBeenCalledTimes(1);

  await act(async () => complete({ success: true }));

  expect(await screen.findByLabelText('Verification code')).toBeTruthy();
  expect(mockSendCode).toHaveBeenCalledTimes(1);
  reopened.unmount();
});
