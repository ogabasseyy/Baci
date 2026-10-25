import { expect, it } from 'vitest';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import { oxygenCustomerStep } from './customer-step';

const base: OxygenRuntimeSnapshot = {
  workflowId: '60000000-0000-4000-8000-000000000001',
  stage: 'eligibility_required',
  version: 1,
  environment: 'staging',
  executionEnabled: true,
  state: {},
  approvalOtpReady: false,
  checkoutPhone: '',
  checkoutAddress: {},
  activationEnabled: false,
  settlementEnabled: false,
};
it('distinguishes phone entry, background verification, selfie, and eligibility within the same durable stage', () => {
  expect(oxygenCustomerStep(base)).toBe('phone');
  expect(oxygenCustomerStep({ ...base, state: { validated: true } })).toBe(
    'verification'
  );
  expect(
    oxygenCustomerStep({
      ...base,
      state: { validated: true, selfieUrl: 'https://hosted.test/selfie' },
    })
  ).toBe('selfie');
  expect(
    oxygenCustomerStep({
      ...base,
      state: {
        validated: true,
        kyc: {
          bvn_status: 'DONE',
          nin_status: 'DONE',
          bank_status: 'DONE',
          phone_status: 'DONE',
          selfie_status: 'DONE',
          address_status: 'NOT_DONE',
        },
      },
    })
  ).toBe('eligibility');
});
it('distinguishes upload/review and upfront-payment/repayment-setup drop-offs', () => {
  expect(oxygenCustomerStep({ ...base, stage: 'booked' })).toBe('address');
  expect(oxygenCustomerStep({ ...base, stage: 'booked' }, true)).toBe(
    'address_review'
  );
  expect(oxygenCustomerStep({ ...base, stage: 'payment_required' })).toBe(
    'upfront_payment'
  );
  expect(
    oxygenCustomerStep({
      ...base,
      stage: 'payment_required',
      state: { paymentComplete: true },
    })
  ).toBe('repayment_setup');
  expect(oxygenCustomerStep({ ...base, stage: 'ready_for_activation' })).toBe(
    'ready_for_activation'
  );
});
