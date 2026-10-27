import {
  act,
  fireEvent,
  render,
  renderHook,
  waitFor,
} from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCustomerLoginForm } from './use-customer-login-form';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  params: new URLSearchParams(),
  sendOtp: vi.fn(),
  verifyOtp: vi.fn(),
  auth: {
    isAuthenticated: false,
    isLoading: false,
    otpState: null as { email: string; codeSent: boolean } | null,
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => mocks.params,
}));
vi.mock('@/contexts/customer-auth-context', () => ({
  useCustomerAuth: () => ({
    ...mocks.auth,
    sendOtp: mocks.sendOtp,
    verifyOtp: mocks.verifyOtp,
    signInWithGoogle: vi.fn(),
  }),
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: () => ({ merchant: null, loading: false }),
}));
vi.mock('@/lib/customer-login-prefill', () => ({
  sanitizeCustomerLoginEmailPrefill: (email: string | null) => email || '',
  fetchCustomerLoginEmailPrefillForRedirect: async () => null,
}));
vi.mock('@/lib/routes', () => ({ asRoute: (path: string) => path }));

describe('useCustomerLoginForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.params.delete('redirect');
    mocks.params.delete('email');
    mocks.auth.isAuthenticated = false;
    mocks.auth.isLoading = false;
    mocks.auth.otpState = null;
  });

  it('reports send failures and retains the email step', async () => {
    mocks.sendOtp.mockResolvedValue({ success: false, error: 'Send failed' });
    const { result } = renderHook(() => useCustomerLoginForm());
    act(() => result.current.setEmail('buyer@example.com'));
    const form = render(
      createElement('form', {
        onSubmit: result.current.handleSendCode,
        'aria-label': 'Send code',
      })
    );
    fireEvent.submit(form.getByRole('form', { name: 'Send code' }));
    await waitFor(() => expect(result.current.isSending).toBe(false));
    expect(mocks.sendOtp).toHaveBeenCalledWith('buyer@example.com');
    expect(result.current.error).toBe('Send failed');
    expect(result.current.showCodeStep).toBe(false);
    expect(result.current.isSending).toBe(false);
  });

  it('reports verification failures and clears the code', async () => {
    mocks.auth.otpState = { codeSent: true, email: 'buyer@example.com' };
    mocks.verifyOtp.mockResolvedValue({
      success: false,
      error: 'Invalid code',
    });
    const { result } = renderHook(() => useCustomerLoginForm());
    const input = render(
      createElement('input', {
        onPaste: result.current.handlePaste,
        'aria-label': 'Code',
      })
    );
    fireEvent.paste(input.getByRole('textbox', { name: 'Code' }), {
      clipboardData: { getData: () => '123456' },
    });
    await waitFor(() => expect(mocks.verifyOtp).toHaveBeenCalledWith('123456'));
    expect(mocks.verifyOtp).toHaveBeenCalledWith('123456');
    await waitFor(() => expect(result.current.error).toBe('Invalid code'));
    expect(result.current.code).toEqual(['', '', '', '', '', '']);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('resends to the challenge address and reports failure', async () => {
    mocks.auth.otpState = { codeSent: true, email: 'buyer@example.com' };
    mocks.sendOtp.mockResolvedValue({ success: false, error: 'Resend failed' });
    const { result } = renderHook(() => useCustomerLoginForm());
    act(() => result.current.handleCodeChange(0, '1'));
    await act(async () => result.current.handleResendCode());
    expect(mocks.sendOtp).toHaveBeenCalledWith('buyer@example.com');
    expect(result.current.error).toBe('Resend failed');
    expect(result.current.code).toEqual(['', '', '', '', '', '']);
  });

  it('clears digits and stays on the code step after a successful resend', async () => {
    mocks.auth.otpState = { codeSent: true, email: 'buyer@example.com' };
    mocks.sendOtp.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useCustomerLoginForm());
    act(() => result.current.handleCodeChange(0, '1'));
    await act(async () => result.current.handleResendCode());
    expect(result.current.showCodeStep).toBe(true);
    expect(result.current.code).toEqual(['', '', '', '', '', '']);
    expect(result.current.error).toBe('');
  });

  it('keeps the replacement email step on failure and returns to the new challenge on success', async () => {
    mocks.auth.otpState = { codeSent: true, email: 'old@example.com' };
    const { result, rerender } = renderHook(() => useCustomerLoginForm());
    act(() => result.current.handleDifferentEmail());
    act(() => result.current.setEmail('new@example.com'));
    mocks.sendOtp.mockResolvedValueOnce({ success: false });
    const form = render(
      createElement('form', {
        onSubmit: result.current.handleSendCode,
        'aria-label': 'Send code',
      })
    );
    fireEvent.submit(form.getByRole('form', { name: 'Send code' }));
    await waitFor(() => expect(result.current.isSending).toBe(false));
    expect(result.current.showCodeStep).toBe(false);
    mocks.sendOtp.mockImplementationOnce(async () => {
      mocks.auth.otpState = { codeSent: true, email: 'new@example.com' };
      return { success: true };
    });
    form.rerender(
      createElement('form', {
        onSubmit: result.current.handleSendCode,
        'aria-label': 'Send code',
      })
    );
    fireEvent.submit(form.getByRole('form', { name: 'Send code' }));
    await waitFor(() => expect(result.current.showCodeStep).toBe(true));
    rerender();
    expect(result.current.showCodeStep).toBe(true);
    expect(result.current.otpState?.email).toBe('new@example.com');
  });

  it.each([
    '/\\evil.example',
    '//evil.example',
    'https://evil.example',
  ])('rejects unsafe redirect %s', async (redirect) => {
    mocks.params.set('redirect', redirect);
    mocks.auth.isAuthenticated = true;
    renderHook(() => useCustomerLoginForm());
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/account'));
  });

  it('redirects to the requested local path after successful verification', async () => {
    mocks.params.set('redirect', '/imei-check');
    mocks.auth.otpState = { codeSent: true, email: 'buyer@example.com' };
    mocks.verifyOtp.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useCustomerLoginForm());
    const input = render(
      createElement('input', {
        onPaste: result.current.handlePaste,
        'aria-label': 'Code',
      })
    );
    fireEvent.paste(input.getByRole('textbox', { name: 'Code' }), {
      clipboardData: { getData: () => '123456' },
    });
    await waitFor(() => expect(mocks.verifyOtp).toHaveBeenCalledWith('123456'));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/imei-check'));
  });
});
