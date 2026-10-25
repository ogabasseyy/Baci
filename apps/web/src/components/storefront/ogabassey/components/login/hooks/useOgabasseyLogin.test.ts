import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOgabasseyLogin } from './useOgabasseyLogin';

const mockRouterPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

interface MockOtpState {
  codeSent: boolean;
  email?: string;
  expiresAt?: number;
}

const mockSendOtp = vi.fn();
const mockVerifyOtp = vi.fn();
const mockSignInWithGoogle = vi.fn();
const mockSignInWithApple = vi.fn();
let mockOtpState: MockOtpState | null = null;

vi.mock('@/contexts/customer-auth-context', () => ({
  useCustomerAuth: () => ({
    otpState: mockOtpState,
    sendOtp: mockSendOtp,
    signInWithApple: mockSignInWithApple,
    signInWithGoogle: mockSignInWithGoogle,
    verifyOtp: mockVerifyOtp,
  }),
}));

vi.mock('@/lib/routes', () => ({
  asRoute: (path: string) => path,
}));

describe('useOgabasseyLogin', () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.clearAllMocks();
    mockOtpState = null;
    mockSendOtp.mockResolvedValue({ success: true });
    mockVerifyOtp.mockResolvedValue({ success: true });
    mockSignInWithGoogle.mockResolvedValue({ success: true });
    mockSignInWithApple.mockResolvedValue({ success: true });
  });

  it('waits for server confirmation before success and redirect, and submits only once', async () => {
    vi.useFakeTimers();
    const response = Promise.withResolvers<{ success: boolean }>();
    mockVerifyOtp.mockReturnValue(response.promise);
    mockOtpState = {
      codeSent: true,
      email: 'first@example.com',
      expiresAt: Date.now() + 600000,
    };
    const { result } = renderHook(() =>
      useOgabasseyLogin({ redirectTo: '/imei-check' })
    );
    let completed!: Promise<void>;
    act(() => {
      completed = result.current.handleCompleteCode('123456');
      void result.current.handleCompleteCode('123456');
    });
    expect(mockVerifyOtp).toHaveBeenCalledTimes(1);
    expect(result.current.verified).toBe(false);
    expect(mockRouterPush).not.toHaveBeenCalled();
    await act(async () => {
      response.resolve({ success: true });
      await Promise.resolve();
    });
    expect(result.current.verified).toBe(true);
    expect(mockRouterPush).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
      await completed;
    });
    expect(mockRouterPush).toHaveBeenCalledWith('/imei-check');
    expect(result.current.code).toBe('');
  });

  it('retains the code recipient after successful verification clears temporary auth state', async () => {
    vi.useFakeTimers();
    mockOtpState = { codeSent: true, email: 'first@example.com' };
    const response = Promise.withResolvers<{ success: boolean }>();
    mockVerifyOtp.mockReturnValue(response.promise);
    const { result, rerender } = renderHook(() =>
      useOgabasseyLogin({ redirectTo: '/imei-check' })
    );
    let completion!: Promise<void>;
    act(() => {
      completion = result.current.handleCompleteCode('123456');
    });
    mockOtpState = null;
    rerender();
    expect(result.current.sentToEmail).toBe('first@example.com');
    await act(async () => {
      response.resolve({ success: true });
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
      await completion;
    });
  });

  it('keeps failed and uncertain verification out of the success state', async () => {
    mockVerifyOtp.mockRejectedValue(new Error('private upstream details'));
    const { result } = renderHook(() =>
      useOgabasseyLogin({ redirectTo: '/imei-check' })
    );
    await act(async () => {
      await result.current.handleCompleteCode('123456');
    });
    expect(result.current.verified).toBe(false);
    expect(result.current.isVerifying).toBe(false);
    expect(result.current.error).toMatch(/could not verify/i);
    expect(result.current.error).not.toContain('private');
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it('preserves the code after a failed resend and clears it only after acknowledgment', async () => {
    const { result } = renderHook(() =>
      useOgabasseyLogin({ redirectTo: '/account' })
    );
    act(() => result.current.handleCodeChange('123'));
    mockSendOtp.mockResolvedValueOnce({ success: false, error: 'Try later' });
    await act(async () => {
      expect(await result.current.handleResendCode()).toBe(false);
    });
    expect(result.current.code).toBe('123');
    await act(async () => {
      expect(await result.current.handleResendCode()).toBe(true);
    });
    expect(result.current.code).toBe('');
  });

  it('returns to email entry without sending another code automatically', () => {
    mockOtpState = { codeSent: true, email: 'first@example.com' };
    const { result } = renderHook(() =>
      useOgabasseyLogin({ redirectTo: '/account' })
    );
    act(() => result.current.handleChangeEmail());
    expect(result.current.isCodeSent).toBe(false);
    expect(mockSendOtp).not.toHaveBeenCalled();
  });

  it('syncs the email when an untouched initial email changes before OTP starts', () => {
    const { rerender, result } = renderHook(
      ({ initialEmail }) =>
        useOgabasseyLogin({ initialEmail, redirectTo: '/account' }),
      { initialProps: { initialEmail: 'first@example.com' } }
    );

    expect(result.current.email).toBe('first@example.com');

    rerender({ initialEmail: 'second@example.com' });

    expect(result.current.email).toBe('second@example.com');
  });

  it('does not overwrite a user-edited email when initial email changes', () => {
    const { rerender, result } = renderHook(
      ({ initialEmail }) =>
        useOgabasseyLogin({ initialEmail, redirectTo: '/account' }),
      { initialProps: { initialEmail: 'first@example.com' } }
    );

    act(() => {
      result.current.setEmail('typed@example.com');
    });
    rerender({ initialEmail: 'second@example.com' });

    expect(result.current.email).toBe('typed@example.com');
  });

  it('does not sync initial email changes after OTP starts', () => {
    const { rerender, result } = renderHook(
      ({ initialEmail }) =>
        useOgabasseyLogin({ initialEmail, redirectTo: '/account' }),
      { initialProps: { initialEmail: 'first@example.com' } }
    );

    mockOtpState = { codeSent: true, email: 'first@example.com' };
    rerender({ initialEmail: 'second@example.com' });

    expect(result.current.email).toBe('first@example.com');
  });
});
