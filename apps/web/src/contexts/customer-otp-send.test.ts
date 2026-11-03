import { afterEach, expect, it, vi } from 'vitest';
import { CUSTOMER_OTP_TTL_SECONDS } from '@/lib/customer-auth-constants';
import { sendCustomerOtpRequest } from './customer-otp-send';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('does not extend the estimated challenge window when the send response is delayed', async () => {
  let now = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      now += 90_000;
      return Response.json({ success: true });
    })
  );
  const result = await sendCustomerOtpRequest(
    'customer@example.com',
    'ogabassey'
  );
  expect(result).toEqual({
    success: true,
    expiresAt: 1_000_000 + CUSTOMER_OTP_TTL_SECONDS * 1000,
  });
});
it('returns the server error when sending fails', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error: 'Please retry' }, { status: 429 }))
  );
  expect(
    await sendCustomerOtpRequest('customer@example.com', 'ogabassey')
  ).toEqual({ success: false, error: 'Please retry' });
});
