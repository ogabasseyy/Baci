import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CheckoutCodeSignin } from './checkout-code-signin';

const auth = vi.hoisted(() => ({ sendOtp: vi.fn(), verifyOtp: vi.fn() }));
vi.mock('@/contexts/customer-auth-context', () => ({
  useOptionalCustomerAuth: () => auth,
  useCustomerAuth: () => auth,
}));
afterEach(() => vi.useRealTimers());
beforeEach(() => {
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
  vi.useFakeTimers({ shouldAdvanceTime: true });
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
  vi.useRealTimers();
  await waitFor(() => expect(auth.sendOtp).toHaveBeenCalledTimes(2));
});
it('keeps the current code entry visible if resending fails', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  auth.sendOtp
    .mockResolvedValueOnce({ success: true })
    .mockResolvedValueOnce({ success: false });
  render(<CheckoutCodeSignin merchantSlug="shop" onSuccess={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), {
    target: { value: 'buyer@example.test' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send sign-in code' }));
  await screen.findByRole('textbox', { name: 'Verification code' });
  await screen.findByRole('button', { name: /Resend code in/ });
  act(() => vi.advanceTimersByTime(61_000));
  fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));
  vi.useRealTimers();
  expect(
    await screen.findByText(/could not send a new code/i)
  ).toBeInTheDocument();
  expect(
    screen.getByRole('textbox', { name: 'Verification code' })
  ).toBeInTheDocument();
});
