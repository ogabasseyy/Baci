import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from 'vitest';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  send: vi.fn(),
  verify: vi.fn(),
  provider: vi.fn(),
}));
vi.mock('@/contexts/customer-auth-context', () => ({
  CustomerAuthProvider: ({
    children,
    merchantSlug,
  }: {
    children: ReactNode;
    merchantSlug: string;
  }) => {
    m.provider(merchantSlug);
    return children;
  },
  useCustomerAuth: m.auth,
}));

import { OxygenSignIn } from './OxygenSignIn';

beforeEach(() => {
  vi.clearAllMocks();
  m.send.mockResolvedValue({ success: true });
  m.verify.mockResolvedValue({ success: true });
  m.auth.mockReturnValue({
    isLoading: false,
    isAuthenticated: false,
    sendOtp: m.send,
    verifyOtp: m.verify,
  });
});
beforeAll(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
);
afterAll(() => vi.unstubAllGlobals());
afterEach(async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
});
async function sendCode() {
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'customer@example.invalid' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Email me a sign-in code' })
  );
  await screen.findByLabelText('Verification code');
}
it('uses the existing store email-code flow with no password or provider OTP confusion', async () => {
  const signedIn = vi.fn();
  render(<OxygenSignIn merchantSlug="shop" onSignedIn={signedIn} />);
  expect(m.provider).toHaveBeenCalledWith('shop');
  expect(screen.queryByLabelText('Password')).toBeNull();
  expect(
    screen.getByText(/separate from Oxygen’s phone verification/)
  ).toBeVisible();
  await sendCode();
  expect(m.send).toHaveBeenCalledExactlyOnceWith('customer@example.invalid');
  fireEvent.change(screen.getByLabelText('Verification code'), {
    target: { value: '012345' },
  });
  await waitFor(() => expect(signedIn).toHaveBeenCalledTimes(1));
  expect(m.verify).toHaveBeenCalledExactlyOnceWith('012345');
});
it('keeps a rejected sign-in code recoverable and acknowledges resend only after success', async () => {
  const signedIn = vi.fn();
  m.verify.mockResolvedValue({
    success: false,
    error: 'Verification code has expired. Please request a new one.',
  });
  render(<OxygenSignIn merchantSlug="shop" onSignedIn={signedIn} />);
  await sendCode();
  const input = screen.getByLabelText('Verification code');
  fireEvent.change(input, { target: { value: '000000' } });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Verification code has expired'
  );
  expect(input).toHaveValue('');
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(signedIn).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Resend sign-in code' }));
  expect(
    await screen.findByText('A new sign-in code has been sent.')
  ).toBeVisible();
  expect(m.send).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).toBeNull();
});
it('does not advance or claim delivery when sending fails', async () => {
  m.send.mockResolvedValue({
    success: false,
    error: 'Too many requests. Please wait.',
  });
  render(<OxygenSignIn merchantSlug="shop" onSignedIn={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'customer@example.invalid' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Email me a sign-in code' })
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Too many requests'
  );
  expect(screen.queryByLabelText('Verification code')).toBeNull();
  expect(m.verify).not.toHaveBeenCalled();
});
it('continues silently when the existing customer session refresh succeeds', async () => {
  m.auth.mockReturnValue({
    isLoading: false,
    isAuthenticated: true,
    sendOtp: m.send,
    verifyOtp: m.verify,
  });
  const signedIn = vi.fn();
  const view = render(
    <OxygenSignIn merchantSlug="shop" onSignedIn={signedIn} />
  );
  view.rerender(<OxygenSignIn merchantSlug="shop" onSignedIn={signedIn} />);
  await waitFor(() => expect(signedIn).toHaveBeenCalledTimes(1));
  expect(m.send).not.toHaveBeenCalled();
  expect(screen.queryByRole('form')).toBeNull();
});
it('fails closed without store context instead of guessing an account or store', () => {
  render(<OxygenSignIn onSignedIn={vi.fn()} />);
  expect(
    screen.getByText(/Open this application from your store’s checkout/)
  ).toBeVisible();
  expect(m.auth).not.toHaveBeenCalled();
  expect(screen.queryByRole('form')).toBeNull();
});
