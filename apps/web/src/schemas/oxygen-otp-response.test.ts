import { expect, it } from 'vitest';
import { oxygenOtpResendResponseSchema } from './oxygen-otp-response';

it.each([
  { message: 'OTP retriggered for validation' },
  { Message: 'OTP retriggered for validation' },
])('accepts the observed casing variant %j', (value) => {
  expect(oxygenOtpResendResponseSchema.safeParse(value).success).toBe(true);
});
it.each([
  {},
  { Message: 'Unknown result' },
  { message: 123 },
  { message: 'OTP retriggered for validation', Message: 'Not sent' },
])('fails closed for an unknown or conflicting response %j', (value) => {
  expect(oxygenOtpResendResponseSchema.safeParse(value).success).toBe(false);
});
