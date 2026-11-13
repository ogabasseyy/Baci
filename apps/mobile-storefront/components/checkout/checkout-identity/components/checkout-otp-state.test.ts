import { OTP_CODE_EXPIRY_MS, OTP_RESEND_COOLDOWN_MS } from '../constants';
import { checkoutOtpState } from './checkout-otp-state';

afterEach(() => {
  jest.useRealTimers();
});

it('expires pending and resend state after their configured windows', async () => {
  jest.useFakeTimers().setSystemTime(10_000);
  await checkoutOtpState.sendOnce('valid@example.com', async () => ({
    success: true,
  }));

  expect(checkoutOtpState.hasPending('valid@example.com')).toBe(true);
  expect(checkoutOtpState.getResendCooldown('valid@example.com')).toBe(
    10_000 + OTP_RESEND_COOLDOWN_MS
  );

  jest.setSystemTime(10_000 + OTP_RESEND_COOLDOWN_MS);
  expect(checkoutOtpState.getResendCooldown('valid@example.com')).toBeNull();
  expect(checkoutOtpState.hasPending('valid@example.com')).toBe(true);

  jest.setSystemTime(10_000 + OTP_CODE_EXPIRY_MS);
  expect(checkoutOtpState.hasPending('valid@example.com')).toBe(false);
});

it('clears both resume and resend state after the code verifies', async () => {
  await checkoutOtpState.sendOnce('buyer@example.com', async () => ({
    success: true,
  }));
  checkoutOtpState.clear('buyer@example.com');

  expect(checkoutOtpState.hasPending('buyer@example.com')).toBe(false);
  expect(checkoutOtpState.getResendCooldown('buyer@example.com')).toBeNull();
});
