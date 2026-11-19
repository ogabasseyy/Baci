import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CheckoutCodeSignin } from './checkout-code-signin';

const auth = vi.hoisted(() => ({
  sendOtp: vi.fn(),
  verifyOtp: vi.fn(),
  signInWithGoogle: vi.fn(),
  signInWithApple: vi.fn(),
}));
vi.mock('@/contexts/customer-auth-context', () => ({
  useOptionalCustomerAuth: () => auth,
  useCustomerAuth: () => auth,
}));
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.clearAllMocks();
  auth.sendOtp.mockResolvedValue({ success: true });
  auth.verifyOtp.mockResolvedValue({ success: true });
});
it('sends and verifies an email code before continuing checkout', async () => {
  const done = vi.fn();
  render(<CheckoutCodeSignin merchantSlug="shop" onSuccess={done} />);
  expect(screen.queryByLabelText(/password/i)).toBeNull();
  fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), {
    target: { value: 'buyer@example.test' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send sign-in code' }));
  await screen.findByRole('textbox', { name: 'Verification code' });
  expect(auth.sendOtp).toHaveBeenCalledWith('buyer@example.test');
  expect(done).not.toHaveBeenCalled();
  await screen.findByText(/Estimated time remaining/);
  fireEvent.change(screen.getByRole('textbox', { name: 'Verification code' }), {
    target: { value: '123456' },
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Verify & continue checkout' })
    ).toBeEnabled()
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Verify & continue checkout' })
  );
  await waitFor(() => expect(done).toHaveBeenCalledOnce());
  expect(auth.verifyOtp).toHaveBeenCalledWith('123456');
});
it('keeps an unsuccessful verification open without navigating', async () => {
  auth.sendOtp.mockResolvedValue({ success: false, error: 'Send unavailable' });
  const done = vi.fn();
  render(<CheckoutCodeSignin merchantSlug="shop" onSuccess={done} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), {
    target: { value: 'buyer@example.test' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send sign-in code' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Send unavailable'
  );
  expect(done).not.toHaveBeenCalled();
});
it('offers resend after its cooldown and requests another code', async () => {
  render(<CheckoutCodeSignin merchantSlug="shop" onSuccess={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), {
    target: { value: 'buyer@example.test' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send sign-in code' }));
  await screen.findByRole('textbox', { name: 'Verification code' });
  expect(
    await screen.findByRole('button', { name: /Resend code in/ })
  ).toBeDisabled();
  act(() => vi.advanceTimersByTime(61_000));
  fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));
  await waitFor(() => expect(auth.sendOtp).toHaveBeenCalledTimes(2));
});
it('keeps the current code entry visible if resending fails', async () => {
  auth.sendOtp
    .mockResolvedValueOnce({ success: true })
    .mockResolvedValueOnce({ success: false });
  render(<CheckoutCodeSignin merchantSlug="shop" onSuccess={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), {
    target: { value: 'buyer@example.test' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send sign-in code' }));
  const codeInput = await screen.findByRole('textbox', {
    name: 'Verification code',
  });
  await screen.findByRole('button', { name: /Resend code in/ });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Use a different email' })
    ).toBeEnabled()
  );
  fireEvent.change(codeInput, { target: { value: '123' } });
  act(() => vi.advanceTimersByTime(61_000));
  fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));
  expect(
    await screen.findByText(/could not send a new code/i)
  ).toBeInTheDocument();
  expect(codeInput).toHaveValue('123');
});
it('locks the form while a code resend is pending', async () => {
  let finish: ((result: { success: boolean }) => void) | undefined;
  auth.sendOtp.mockResolvedValueOnce({ success: true }).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  render(<CheckoutCodeSignin merchantSlug="shop" onSuccess={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), {
    target: { value: 'buyer@example.test' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send sign-in code' }));
  await screen.findByRole('textbox', { name: 'Verification code' });
  await screen.findByRole('button', { name: /Resend code in/ });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Use a different email' })
    ).toBeEnabled()
  );
  act(() => vi.advanceTimersByTime(61_000));
  fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));
  expect(
    screen.getByRole('button', { name: 'Use a different email' })
  ).toBeDisabled();
  await act(async () => finish?.({ success: true }));
});

it.each([
  'Google',
  'Apple',
] as const)('starts %s sign-in with the checkout return path', async (provider) => {
  const fn =
    provider === 'Google' ? auth.signInWithGoogle : auth.signInWithApple;
  fn.mockResolvedValue({ success: true });
  render(
    <CheckoutCodeSignin
      merchantSlug="shop"
      onSuccess={vi.fn()}
      socialReturnTo="/shop/checkout?resume=1"
    />
  );
  fireEvent.click(
    screen.getByRole('button', { name: `Continue with ${provider}` })
  );
  await waitFor(() =>
    expect(fn).toHaveBeenCalledWith('/shop/checkout?resume=1')
  );
});
it('shows a useful error if social sign-in unexpectedly fails', async () => {
  auth.signInWithGoogle.mockRejectedValueOnce(new Error('offline'));
  render(
    <CheckoutCodeSignin
      merchantSlug="shop"
      onSuccess={vi.fn()}
      socialReturnTo="/checkout"
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Unable to continue with Google.'
  );
});

it('keeps controls disabled while a successful social redirect is pending', async () => {
  auth.signInWithGoogle.mockResolvedValueOnce({ success: true });
  render(
    <CheckoutCodeSignin
      merchantSlug="shop"
      onSuccess={vi.fn()}
      socialReturnTo="/checkout"
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
  await waitFor(() => expect(auth.signInWithGoogle).toHaveBeenCalled());
  expect(
    screen.getByRole('button', { name: 'Continue with Google' })
  ).toBeDisabled();
});
it('shows a retry message if the resend request throws', async () => {
  auth.sendOtp
    .mockResolvedValueOnce({ success: true })
    .mockRejectedValueOnce(new Error('offline'));
  render(<CheckoutCodeSignin merchantSlug="shop" onSuccess={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), {
    target: { value: 'buyer@example.test' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send sign-in code' }));
  await screen.findByRole('button', { name: /Resend code in/ });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Use a different email' })
    ).toBeEnabled()
  );
  act(() => vi.advanceTimersByTime(61_000));
  fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'We could not send a new code'
  );
});
