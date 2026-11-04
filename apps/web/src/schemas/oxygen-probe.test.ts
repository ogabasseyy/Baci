import { expect, it } from 'vitest';
import {
  oxygenProbeCheckpointSchema,
  oxygenProbeNameEnquirySchema,
  oxygenProbeOtpSchema,
} from './oxygen-probe';

it('requires the locked checkpoint to match its saved reference and retry state', () => {
  const checkpoint = {
    reference: 'request',
    phone: '2348000000000',
    newUserToken: '',
    customerPath: 'existing',
    createLocked: true,
    retryAvailable: false,
  };
  expect(oxygenProbeCheckpointSchema.safeParse(checkpoint).success).toBe(true);
  expect(
    oxygenProbeCheckpointSchema.safeParse({
      ...checkpoint,
      createLocked: false,
    }).success
  ).toBe(false);
  expect(
    oxygenProbeCheckpointSchema.safeParse({
      ...checkpoint,
      retryAvailable: true,
    }).success
  ).toBe(false);
  expect(
    oxygenProbeCheckpointSchema.safeParse({ ...checkpoint, extra: 'private' })
      .success
  ).toBe(false);
});
it('validates OTP and name enquiry input shapes', () => {
  expect(oxygenProbeOtpSchema.safeParse({ otp: '123456' }).success).toBe(true);
  expect(oxygenProbeOtpSchema.safeParse({ otp: '12a456' }).success).toBe(false);
  const enquiry = {
    bank_code: '058',
    account_number: '1234567890',
    phone_number: '2348000000000',
  };
  expect(oxygenProbeNameEnquirySchema.safeParse(enquiry).success).toBe(true);
  expect(
    oxygenProbeNameEnquirySchema.safeParse({
      ...enquiry,
      account_number: '123',
    }).success
  ).toBe(false);
});
