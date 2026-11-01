import { afterEach, describe, expect, it, vi } from 'vitest';
import { subscribeCustomerIdentityChange } from './customer-live-identity';
import { requestCustomerOtpVerification } from './customer-otp-verification';

afterEach(() => vi.unstubAllGlobals());

describe('customer OTP verification', () => {
  it('invalidates existing identity views before and after a successful auth request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    );
    const listener = vi.fn();
    const unsubscribe = subscribeCustomerIdentityChange(listener);
    await requestCustomerOtpVerification(
      'ogabassey',
      'buyer@example.com',
      '123456'
    );
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('invalidates views for a failed response that may have changed the session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 400 }))
    );
    const listener = vi.fn();
    const unsubscribe = subscribeCustomerIdentityChange(listener);
    await requestCustomerOtpVerification(
      'ogabassey',
      'buyer@example.com',
      'invalid'
    );
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('invalidates before the request can change the cookie and after an ambiguous failure', async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        })
      )
    );
    const listener = vi.fn();
    const unsubscribe = subscribeCustomerIdentityChange(listener);
    const pending = requestCustomerOtpVerification(
      'another-store',
      'buyer@example.com',
      '123456'
    );
    expect(listener).toHaveBeenCalledOnce();
    finish(new Response('{}', { status: 500 }));
    await pending;
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
