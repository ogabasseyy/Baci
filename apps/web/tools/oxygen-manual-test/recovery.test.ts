import { expect, it } from 'vitest';
import { classifyProbeRecovery } from './recovery';

it('reports the remaining KYC fields and redacts unfamiliar statuses', () => {
  expect(
    classifyProbeRecovery('kyc', true, {
      address_status: 'NOT_DONE',
      selfie_status: 'DONE',
      nin_status: 'PROCESSING',
      bvn_status: 'DONE',
      bank_status: 'DONE',
      phone_status: 'private data',
    })
  ).toEqual({
    code: 'kyc_status_received',
    kyc: {
      address: 'NOT_DONE',
      selfie: 'DONE',
      nin: 'PROCESSING',
      bvn: 'DONE',
      bank: 'DONE',
      phone: 'UNKNOWN',
    },
  });
});

it('recognizes the observed duplicate-BVN response without selecting another customer branch', () => {
  expect(
    classifyProbeRecovery('selfie', false, { message: 'BVN already exists' })
  ).toEqual({ code: 'existing_bvn_recovery_required' });
});
it('shows bounded recognized KYC states, preserving incomplete verification', () => {
  expect(
    classifyProbeRecovery('kyc', true, {
      address_status: 'NOT_DONE',
      selfie_status: 'DONE',
    })
  ).toEqual({
    code: 'kyc_status_received',
    kyc: { address: 'NOT_DONE', selfie: 'DONE' },
  });
});
it('does not expose unfamiliar provider status strings or fabricate completion', () => {
  expect(
    classifyProbeRecovery('kyc', true, {
      address_status: 'private@example.com',
      selfie_status: 'APPROVED',
    })
  ).toEqual({
    code: 'kyc_status_received',
    kyc: { address: 'UNKNOWN', selfie: 'UNKNOWN' },
  });
});
it('recognizes only the documented validation success and capitalization variant of resend success', () => {
  expect(
    classifyProbeRecovery('validate-new', true, {
      message: 'Account validation successful',
    })
  ).toEqual({ code: 'customer_validated' });
  expect(
    classifyProbeRecovery('resend-otp', true, {
      Message: 'OTP retriggered for validation',
    })
  ).toEqual({ code: 'otp_resend_accepted' });
  expect(
    classifyProbeRecovery('validate-new', true, { message: 'Something else' })
  ).toEqual({});
});
