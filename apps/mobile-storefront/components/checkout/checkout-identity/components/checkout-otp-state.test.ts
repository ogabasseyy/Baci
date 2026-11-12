import { OTP_CODE_EXPIRY_MS, OTP_RESEND_COOLDOWN_MS } from '../constants';
import {
  clearOtpState,
  getResendCooldown,
  hasPendingOtp,
  pendingOtpEmails,
  resendCooldownsByEmail,
} from './checkout-otp-state';

afterEach(() => {
  jest.useRealTimers();
  pendingOtpEmails.clear();
  resendCooldownsByEmail.clear();
});

it('prunes expired email state when a later email checks for a code', () => {
  jest.useFakeTimers().setSystemTime(10_000);
  pendingOtpEmails.set('old@example.com', 9_999);
  resendCooldownsByEmail.set('old@example.com', 9_999);
  pendingOtpEmails.set('valid@example.com', 10_000 + OTP_CODE_EXPIRY_MS);
  resendCooldownsByEmail.set(
    'valid@example.com',
    10_000 + OTP_RESEND_COOLDOWN_MS
  );

  expect(hasPendingOtp('valid@example.com')).toBe(true);
  expect(getResendCooldown('valid@example.com')).toBe(
    10_000 + OTP_RESEND_COOLDOWN_MS
  );
  expect(pendingOtpEmails.has('old@example.com')).toBe(false);
  expect(resendCooldownsByEmail.has('old@example.com')).toBe(false);
});

it('clears both resume and resend state after the code verifies', () => {
  pendingOtpEmails.set('buyer@example.com', Date.now() + OTP_CODE_EXPIRY_MS);
  resendCooldownsByEmail.set(
    'buyer@example.com',
    Date.now() + OTP_RESEND_COOLDOWN_MS
  );

  clearOtpState('buyer@example.com');

  expect(hasPendingOtp('buyer@example.com')).toBe(false);
  expect(getResendCooldown('buyer@example.com')).toBeNull();
});
