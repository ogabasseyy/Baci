import {
  type OxygenRuntimeSnapshot,
  oxygenRuntimeSnapshotSchema,
} from '@baci/shared/oxygen';
import type { OxygenFields } from '../oxygen-checkout/oxygen-form-utils';

export const previewSteps = [
  'identity',
  'bank',
  'income',
  'phone',
  'selfie',
  'eligibility',
  'plan',
  'address',
  'review',
  'breakdown',
  'signature',
  'code',
  'payment',
  'setup',
  'complete',
] as const;

export type PreviewStep = (typeof previewSteps)[number];
export const productAmount = 198000;
export const bookingReference = '20000000-0000-4000-8000-000000000002';
const applicationReference = '20000000-0000-4000-8000-000000000003';
export const sampleProof = {
  bytes: new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]),
  type: 'application/pdf',
  name: 'Sample utility bill.pdf',
} as const;

export const sampleFields: OxygenFields = {
  first_name: 'Ada',
  last_name: 'Example',
  email: 'ada@example.invalid',
  bvn: '00000000001',
  nin: '00000000002',
  date_of_birth: '1995-06-15',
  bank_code: '058',
  account_number: '0000000003',
  employment_status: 'EMPLOYED',
  name_of_employer: 'Sample Studio',
  salary_amount: '450000',
  salary_date: '26',
  home_street: 'Example Street',
  home_house_number: '12',
  home_city: 'Ikeja',
  home_state: 'Lagos',
  home_lga: 'Ikeja',
  home_landmark: 'Sample Library',
};

export function previewSnapshot(
  step: PreviewStep,
  version: number,
  equityPercentage = 25,
  tenure = 3
) {
  const index = previewSteps.indexOf(step);
  const booking = index >= previewSteps.indexOf('address');
  const stage: OxygenRuntimeSnapshot['stage'] =
    index < 4
      ? 'application_required'
      : index < 6
        ? 'eligibility_required'
        : step === 'plan'
          ? 'plan_required'
          : index < 9
            ? 'booked'
            : index < 12
              ? 'approval_required'
              : step === 'complete'
                ? 'ready_for_activation'
                : 'payment_required';
  const equityAmount = Math.round(productAmount * equityPercentage) / 100;
  const financed = productAmount - equityAmount;
  const toNaira = (amount: number) => Math.round(amount * 100) / 100;
  const charges = 2932.88;
  return oxygenRuntimeSnapshotSchema.parse({
    workflowId: '20000000-0000-4000-8000-000000000001',
    stage,
    version,
    environment: 'staging',
    executionEnabled: true,
    approvalOtpReady: false,
    activationEnabled: false,
    settlementEnabled: false,
    checkoutPhone: '+2348000000001',
    state: {
      ...(index >= 3 && { applicationReference }),
      validated: index >= 4,
      kyc: {
        bvn_status: index >= 4 ? 'DONE' : 'NOT_DONE',
        nin_status: index >= 4 ? 'DONE' : 'NOT_DONE',
        bank_status: index >= 3 ? 'DONE' : 'NOT_DONE',
        phone_status: index >= 4 ? 'DONE' : 'NOT_DONE',
        selfie_status: index >= 5 ? 'DONE' : 'NOT_DONE',
        address_status:
          index >= 9 ? 'DONE' : step === 'review' ? 'PROCESSING' : 'NOT_DONE',
      },
      ...(step === 'eligibility' && { eligibilityStatus: 'pending' }),
      ...(index >= 6 && {
        eligible: true,
        eligibilityStatus: 'completed',
        eligibleAmount: 189000,
        minimumAmount: 68000,
        maxTenure: 3,
        offers: [
          { tenure: 1, loanAmount: 68000 },
          { tenure: 2, loanAmount: 131000 },
          { tenure: 3, loanAmount: 189000 },
        ],
      }),
      ...(booking && {
        bookingReference,
        booking: {
          loan_reference: bookingReference,
          product_amount: productAmount,
          loan_amount: financed,
          equity_percentage: equityPercentage,
          equity_amount: equityAmount,
          loan_tenure: tenure,
          status: index >= 12 ? 'APPROVED' : 'BOOKED',
          total_charges: charges,
          total_upfront_payment: toNaira(equityAmount + charges),
        },
        schedule: Array.from({ length: tenure }, (_, index) => {
          const principal =
            toNaira((financed * (index + 1)) / tenure) -
            toNaira((financed * index) / tenure);
          const interest = 3300;
          return {
            period: index + 1,
            dueDate: [2027, index + 1, 26],
            amount: toNaira(principal + interest),
            principal: toNaira(principal),
            interest,
          };
        }),
        paymentComplete: index >= 13,
        setupComplete: index >= 14,
      }),
    },
  });
}
