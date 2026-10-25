// @vitest-environment node
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type {
  OxygenProviderContext,
  OxygenRuntimeAction,
} from '@/schemas/oxygen-runtime';
import { createOxygenProvider } from './provider';
import { executeOxygenAction } from './runtime-executor';

const app = '60000000-0000-4000-8000-000000000001';
const loan = '70000000-0000-4000-8000-000000000001';
it('runs the real staging adapter through onboarding, booking, address and approval, then stops after status confirmation', async () => {
  let context: OxygenProviderContext = {
    workflowId: app,
    orderId: app,
    environment: 'staging',
    stage: 'application_required',
    version: 0,
    partnerReference: 'partner',
    merchantReference: null,
    productAmount: 400000,
    orderPhone: '08012345678',
    productName: 'Order 1',
    address: '1 Test Street',
    state: {},
  };
  const requests: { url: string; body: unknown }[] = [];
  let addressDone = false;
  const kyc = () => ({
    bvn_status: 'DONE',
    nin_status: 'DONE',
    bank_status: 'DONE',
    phone_status: 'DONE',
    selfie_status: 'DONE',
    address_status: addressDone ? 'DONE' : 'NOT_DONE',
  });
  const booking = {
    loan_reference: loan,
    product_amount: 400000,
    loan_amount: 260000,
    equity_percentage: 35,
    equity_amount: 140000,
    loan_tenure: 3,
    status: 'BOOKED',
  };
  const provider = createOxygenProvider({
    token: async () => 'synthetic-token',
    fetch: async (url, init) => {
      const path = String(url);
      requests.push({
        url: path,
        body:
          init?.body instanceof FormData
            ? init.body
            : (JSON.parse(String(init?.body)) as unknown),
      });
      if (path.endsWith('/loan-request/create'))
        return Response.json({
          loan_request_reference: app,
          partner_reference: 'partner',
          message: 'OTP sent for validation',
        });
      if (path.endsWith('/validate/existing/user'))
        return Response.json({ message: 'OTP validation successful' });
      if (path.endsWith('/loan-request/get'))
        return Response.json({
          loan_request_reference: app,
          partner_reference: 'partner',
          is_eligible: true,
          status: 'COMPLETED',
          message: 'Eligible',
          eligible_amount: 400000,
          max_loan_amount: 400000,
          minimum_loan_amount: 10000,
          max_tenure: 12,
        });
      if (path.endsWith('/kyc/status')) return Response.json(kyc());
      if (path.endsWith('/book-loan')) return Response.json(booking);
      if (path.endsWith('/validate/address')) {
        addressDone = true;
        return Response.json({ message: 'Address submitted successfully!' });
      }
      if (path.endsWith('/trigger-otp'))
        return Response.json({ activity_token: 'synthetic-activity-token' });
      if (path.endsWith('/approve-loan'))
        return Response.json({
          ...booking,
          status: 'APPROVED',
          total_charges: 5135,
          total_upfront_payment: 145135,
          first_repayment: 145135,
          split_payment_link: 'https://hosted.test/payment',
          repayment_setup_link: 'https://hosted.test/setup',
        });
      if (path.endsWith('/confirmation'))
        return Response.json({
          split_payment: { completed: true },
          repayment_setup: { completed: true },
        });
      throw new Error('Unexpected operation');
    },
  });
  const steps: OxygenRuntimeAction[] = [
    {
      action: 'start_application',
      customer: {
        accept_terms_and_condition: 'yes',
        user_category: 'individual',
        customer_personal_details: {
          external_identifier: '',
          first_name: 'Test',
          last_name: 'Customer',
          middle_name: '',
          phone_number: '2348012345678',
          email: 'test@example.test',
          bvn: '00000000000',
          nin: '00000000000',
          date_of_birth: '1994-09-30',
        },
        customer_bank_details: {
          bank_code: '001',
          bank_name: 'Test bank',
          account_number: '0000000000',
          account_name: 'Test Customer',
        },
        customer_employment_details: {
          employment_status: 'EMPLOYED',
          name_of_employer: 'Test',
          salary_amount: '500000',
          salary_date: 28,
        },
      },
    },
    { action: 'validate_customer', otp: '123456' },
    { action: 'refresh_kyc' },
    { action: 'refresh_eligibility' },
    { action: 'book', equityPercentage: 35, tenure: 3 },
    {
      action: 'submit_address',
      state: 'Lagos',
      lga: 'Ikeja',
      city: 'Ikeja',
      street: 'Street',
      house_number: '1',
      landmark: 'Mall',
    },
    { action: 'refresh_kyc' },
    { action: 'trigger_approval_otp' },
    { action: 'approve_booking', otp: '852963', accepted: true },
    { action: 'refresh_payment_setup' },
  ];
  const stages: string[] = [];
  for (const command of steps) {
    const result = await executeOxygenAction(
      context,
      command,
      provider,
      new Set(['hosted.test']),
      ['submit_address', 'approve_booking'].includes(command.action)
        ? {
            name: 'proof.png',
            type: 'image/png',
            bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
          }
        : undefined
    );
    context = { ...context, ...result, version: context.version + 1 };
    stages.push(result.stage);
  }
  expect(stages).toEqual([
    'eligibility_required',
    'eligibility_required',
    'eligibility_required',
    'plan_required',
    'booked',
    'booked',
    'approval_required',
    'approval_required',
    'payment_required',
    'ready_for_activation',
  ]);
  expect(
    requests.findIndex((request) => request.url.endsWith('/kyc/status'))
  ).toBeLessThan(
    requests.findIndex((request) => request.url.endsWith('/loan-request/get'))
  );
  expect(context.state.booking?.total_upfront_payment).toBe(145135);
  expect(context.state.activityToken).toBeUndefined();
  expect(
    requests.some((r) => r.url.includes('activate') || r.url.includes('settle'))
  ).toBe(false);
  const approval = requests.find((r) => r.url.endsWith('/approve-loan'))
    ?.body as FormData;
  expect(approval.get('otp')).toBe('852963');
  expect(approval.get('signature')).toBeInstanceOf(File);
  expect(JSON.stringify(context.state)).not.toContain('852963');
  expect(JSON.stringify(context.state)).not.toContain('residency_document');
});
