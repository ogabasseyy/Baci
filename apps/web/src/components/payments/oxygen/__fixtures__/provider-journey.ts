import type { OxygenProvider } from '@/lib/payments/oxygen/provider';
import { OxygenProviderFailure } from '@/lib/payments/oxygen/provider';
import { executeOxygenAction } from '@/lib/payments/oxygen/runtime-executor';
import type {
  OxygenProviderContext,
  OxygenTransientFile,
} from '@/schemas/oxygen-runtime';
import { oxygenRuntimeSubmissionSchema } from '@/schemas/oxygen-runtime';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import { oxygenWorkflowStageSchema } from '@/schemas/oxygen-workflow';

export const fixtureId = '60000000-0000-4000-8000-000000000001';
const loanId = '70000000-0000-4000-8000-000000000001';
export function createProviderJourney() {
  let context: OxygenProviderContext = {
    workflowId: fixtureId,
    orderId: fixtureId,
    environment: 'staging',
    stage: 'eligibility_required',
    version: 1,
    partnerReference: 'synthetic-partner',
    merchantReference: null,
    productAmount: 400000,
    orderPhone: '08012345678',
    productName: 'Synthetic fixture',
    address: '1 Test Street',
    state: {
      applicationReference: fixtureId,
      phone: '2348012345678',
      customerPath: 'existing',
    },
  };
  let ninDone = false;
  let selfieDone = false;
  let addressDone = false;
  let addressSubmitted = false;
  let eligibility: 'eligible' | 'pending' | 'ineligible' = 'eligible';
  let timeoutNext = false;
  let rateLimited = false;
  let paymentDone = false;
  let setupDone = false;
  const actions: string[] = [];
  const operations: string[] = [];
  const booking = {
    loan_reference: loanId,
    product_amount: 400000,
    loan_amount: 260000,
    equity_percentage: 35,
    equity_amount: 140000,
    loan_tenure: 3,
    status: 'BOOKED' as const,
    total_charges: 5135,
    total_upfront_payment: 145135,
  };
  const snapshot = (): OxygenRuntimeSnapshot => {
    const state = { ...context.state };
    delete state.phone;
    delete state.newUserToken;
    delete state.activityToken;
    return {
      workflowId: context.workflowId,
      stage: oxygenWorkflowStageSchema.parse(context.stage),
      version: context.version,
      environment: 'staging',
      executionEnabled: true,
      state,
      approvalOtpReady: Boolean(context.state.activityToken),
      checkoutPhone: '',
      checkoutAddress: {
        state: 'Lagos',
        lga: 'Ikeja',
        city: 'Ikeja',
        street: 'Test Street',
        house_number: '1',
        landmark: 'Test landmark',
      },
      activationEnabled: false,
      settlementEnabled: false,
    };
  };
  const provider: OxygenProvider = {
    async call(operation, input) {
      await Promise.resolve();
      operations.push(operation);
      if (timeoutNext) {
        timeoutNext = false;
        throw new OxygenProviderFailure('indeterminate');
      }
      if (operation === 'validate_existing') {
        if (!(input instanceof FormData) && input.otp !== '123456')
          throw new OxygenProviderFailure('rejected', 'OXYGEN_OTP_INVALID');
        return { message: 'OTP validation successful' };
      }
      if (operation === 'resend_existing')
        return { Message: 'OTP retriggered for validation' };
      if (operation === 'kyc')
        return {
          bvn_status: 'DONE',
          phone_status: 'DONE',
          bank_status: 'DONE',
          nin_status: ninDone ? 'DONE' : 'NOT_DONE',
          selfie_status: selfieDone ? 'DONE' : 'NOT_DONE',
          address_status: addressDone
            ? 'DONE'
            : addressSubmitted
              ? 'PROCESSING'
              : 'NOT_DONE',
        };
      if (operation === 'nin') {
        ninDone = true;
        return { nin_status: 'DONE' };
      }
      if (operation === 'selfie') return { url: 'https://hosted.test/selfie' };
      if (operation === 'eligibility')
        return {
          loan_request_reference: fixtureId,
          partner_reference: 'synthetic-partner',
          is_eligible: eligibility === 'eligible',
          status: eligibility === 'pending' ? 'PROCESSING' : 'COMPLETED',
          message: eligibility === 'eligible' ? 'Eligible' : 'Unavailable',
          eligible_amount: 400000,
          max_loan_amount: 400000,
          minimum_loan_amount: 10000,
          max_tenure: 12,
        };
      if (operation === 'approval_otp')
        return { activity_token: 'synthetic-activity-token' };
      if (operation === 'approve')
        return {
          ...booking,
          status: 'APPROVED',
          first_repayment: 145135,
          split_payment_link: 'https://hosted.test/payment',
          repayment_setup_link: 'https://hosted.test/setup',
        };
      if (operation === 'payment')
        return {
          split_payment: { completed: paymentDone },
          repayment_setup: { completed: setupDone },
        };
      if (operation === 'book') return booking;
      if (operation === 'details')
        return {
          periods: [
            {
              period: null,
              dueDate: null,
              totalInstallmentAmountForPeriod: null,
              principalDue: null,
              interestDue: null,
              totalOriginalDueForPeriod: 5135,
            },
            ...[90000, 90000, 80000].map((principal, index) => ({
              period: index + 1,
              dueDate: [2026, index + 10, 25],
              totalInstallmentAmountForPeriod: principal + 5000,
              principalDue: principal,
              interestDue: 5000,
            })),
          ],
        };
      if (operation === 'address') {
        addressSubmitted = true;
        return { message: 'Address submitted successfully!' };
      }
      throw new Error(`Unexpected simulated operation: ${operation}`);
    },
  };
  return {
    snapshot,
    actions,
    operations,
    finishNin() {
      ninDone = true;
    },
    finishSelfie() {
      selfieDone = true;
    },
    finishAddress() {
      addressDone = true;
    },
    setEligibility(value: typeof eligibility) {
      eligibility = value;
    },
    rateLimitNext() {
      rateLimited = true;
    },
    timeout() {
      timeoutNext = true;
    },
    finishPayment() {
      paymentDone = true;
    },
    finishSetup() {
      setupDone = true;
    },
    resumeApproval() {
      ninDone = true;
      selfieDone = true;
      addressDone = true;
      context = {
        ...context,
        stage: 'approval_required',
        state: {
          ...context.state,
          validated: true,
          eligible: true,
          bookingReference: loanId,
          booking,
          kyc: {
            bvn_status: 'DONE',
            nin_status: 'DONE',
            bank_status: 'DONE',
            phone_status: 'DONE',
            selfie_status: 'DONE',
            address_status: 'DONE',
          },
        },
      };
    },
    resumeValidated() {
      context.state.validated = true;
    },
    resumeBook() {
      context = {
        ...context,
        stage: 'booked',
        state: {
          ...context.state,
          validated: true,
          eligible: true,
          bookingReference: loanId,
          booking,
        },
      };
    },
    async fetch(url: string, init?: RequestInit) {
      if (url.includes('/plans?'))
        return Response.json({ plans: [], selectedReference: null });
      if (url.endsWith('/workflows'))
        return Response.json({ workflow: { id: fixtureId } });
      if (url.includes('/actions?')) return Response.json(snapshot());
      if (!url.endsWith('/actions') || init?.method !== 'POST')
        throw new Error('Unexpected simulated request');
      if (rateLimited) {
        rateLimited = false;
        return Response.json({ error: 'Too many requests' }, { status: 429 });
      }
      let raw: unknown;
      let file: OxygenTransientFile | undefined;
      if (init.body instanceof FormData) {
        raw = JSON.parse(String(init.body.get('payload')));
        const upload = init.body.get('file');
        if (upload && typeof upload !== 'string')
          file = {
            bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
            name: upload.name,
            type: upload.type,
          };
      } else raw = JSON.parse(String(init.body));
      const request = oxygenRuntimeSubmissionSchema.parse(raw);
      actions.push(request.command.action);
      try {
        const next = await executeOxygenAction(
          context,
          request.command,
          provider,
          new Set(['hosted.test']),
          file
        );
        context = { ...context, ...next, version: context.version + 1 };
        return Response.json(snapshot());
      } catch (error) {
        if (
          error instanceof OxygenProviderFailure &&
          error.outcome === 'indeterminate'
        )
          context.stage = 'reconciliation_required';
        context.version += 1;
        return Response.json(
          error instanceof OxygenProviderFailure &&
            error.code === 'OXYGEN_OTP_INVALID'
            ? {
                code: error.code,
                error:
                  'That code isn’t valid. Check the six digits or request a new code.',
              }
            : { error: 'Unable to confirm' },
          { status: 409 }
        );
      }
    },
  };
}
