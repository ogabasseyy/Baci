import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CheckoutCodeSignin } from './checkout-code-signin';

const auth = vi.hoisted(() => ({ sendOtp: vi.fn(), verifyOtp: vi.fn() }));
vi.mock('@/contexts/customer-auth-context', () => ({
  useOptionalCustomerAuth: () => auth,
  useCustomerAuth: () => auth,
}));
beforeEach(() => {
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
  fireEvent.change(screen.getByRole('textbox', { name: 'Verification code' }), {
    target: { value: '123456' },
  });
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
