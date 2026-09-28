import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@/lib/supabase/client';
import {
  signUpCheckoutCustomer,
  type CheckoutSignupAttempt,
} from './sign-up-checkout-customer';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

function options(attempt: CheckoutSignupAttempt) {
  return {
    attempt,
    enabled: true,
    hasUser: false,
    password: 'password-123',
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Okon',
    phone: '08000000000',
  };
}

describe('signUpCheckoutCustomer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not issue a second signup when checkout invokes both signup phases', async () => {
    const signUp = vi.fn(async () => ({ data: {}, error: null }));
    vi.mocked(createClient).mockReturnValue({
      auth: { signUp },
    } as never);
    const attempt = { current: false };

    await signUpCheckoutCustomer({ ...options(attempt), logSuccess: true });
    await signUpCheckoutCustomer(options(attempt));

    expect(signUp).toHaveBeenCalledOnce();
    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'ada@example.com',
        options: expect.objectContaining({
          data: expect.objectContaining({ signup_type: 'customer' }),
        }),
      })
    );
  });

  it('keeps a returned signup error nonblocking and logs no response details', async () => {
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const signUp = vi.fn(async () => ({
      data: {},
      error: { message: 'email address already registered' },
    }));
    vi.mocked(createClient).mockReturnValue({
      auth: { signUp },
    } as never);

    await expect(
      signUpCheckoutCustomer(options({ current: false }))
    ).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledWith('Silent signup background error');
    expect(logError).not.toHaveBeenCalledWith(
      expect.stringContaining('registered')
    );
  });
});
