import { expect, it, vi } from 'vitest';
import type {
  OxygenProviderContext,
  OxygenProviderState,
} from '@/schemas/oxygen-runtime';
import { oxygenProviderStateSchema } from '@/schemas/oxygen-runtime';
import { refreshOxygenEligibility } from './runtime-eligibility';

vi.mock('server-only', () => ({}));
const context = { partnerReference: 'partner' } as OxygenProviderContext;
const response = {
  loan_request_reference: 'application',
  partner_reference: 'partner',
  status: 'COMPLETED',
  is_eligible: true,
  message: '',
  eligible_amount: 200000,
  max_loan_amount: 250000,
  minimum_loan_amount: 10000,
  max_tenure: 6,
};
it('retains Oxygen limits for each repayment period', async () => {
  const state: OxygenProviderState = { applicationReference: 'application' };
  await refreshOxygenEligibility(context, state, {
    call: vi.fn().mockResolvedValue({
      ...response,
      tenure_unit: 'Monthly',
      offers: [
        { loan_amount: 68000, tenor: 1 },
        { loan_amount: 131000, tenor: 2 },
        { loan_amount: 189000, tenor: 3 },
      ],
    }),
  });
  expect(state).toMatchObject({
    offers: [
      { loanAmount: 68000, tenure: 1 },
      { loanAmount: 131000, tenure: 2 },
      { loanAmount: 189000, tenure: 3 },
    ],
  });
});
it('does not retain old offers when the provider omits them', async () => {
  const state: OxygenProviderState = {
    applicationReference: 'application',
    offers: [{ tenure: 1, loanAmount: 68000 }],
  };
  await refreshOxygenEligibility(context, state, {
    call: vi.fn().mockResolvedValue(response),
  });
  expect(state.offers).toBeUndefined();
});
it('treats an empty offer list as no bookable options without inventing terms', async () => {
  const application = '60000000-0000-4000-8000-000000000001';
  const state: OxygenProviderState = { applicationReference: application };
  await refreshOxygenEligibility(context, state, {
    call: vi.fn().mockResolvedValue({
      ...response,
      loan_request_reference: application,
      offers: [],
    }),
  });
  expect(state.eligible).toBe(true);
  expect(state.offers).toBeUndefined();
  expect(oxygenProviderStateSchema.safeParse(state).success).toBe(true);
});
it('keeps an empty pending response pending instead of treating it as a decline', async () => {
  const state: OxygenProviderState = { applicationReference: 'application' };
  await refreshOxygenEligibility(context, state, {
    call: vi.fn().mockResolvedValue({
      ...response,
      status: 'PENDING',
      is_eligible: false,
      offers: [],
    }),
  });
  expect(state.eligibilityStatus).toBe('pending');
  expect(state.eligible).toBeUndefined();
  expect(state.offers).toBeUndefined();
});
it('retains a safe reason for the observed financial-details mismatch', async () => {
  const state: OxygenProviderState = {
    applicationReference: '60000000-0000-4000-8000-000000000001',
  };
  await refreshOxygenEligibility(context, state, {
    call: vi.fn().mockResolvedValue({
      ...response,
      loan_request_reference: state.applicationReference,
      status: 'FAILED',
      is_eligible: false,
      offers: [],
      message:
        'Your financial details do not match. Please visit your bank to regularize or contact support for help private@example.test',
    }),
  });
  expect(state).toMatchObject({
    eligibilityStatus: 'failed',
    eligibilityFailureReason: 'financial_details_mismatch',
  });
  expect(state.eligible).toBeUndefined();
  expect(oxygenProviderStateSchema.parse(state)).toEqual(state);
  expect(JSON.stringify(state)).not.toContain('private@example.test');
});

it.each([
  ['FAILED', 'An unexpected failure for private@example.test'],
  ['PENDING', 'Your financial details do not match. Please visit your bank.'],
  ['COMPLETED', 'Your financial details do not match. Please visit your bank.'],
])('clears an old reason for %s without retaining provider text', async (status, message) => {
  const state = {
    applicationReference: '60000000-0000-4000-8000-000000000001',
    eligibilityFailureReason: 'financial_details_mismatch',
  } as OxygenProviderState;
  await refreshOxygenEligibility(context, state, {
    call: vi.fn().mockResolvedValue({
      ...response,
      loan_request_reference: state.applicationReference,
      status,
      is_eligible: false,
      offers: [],
      message,
    }),
  });
  expect(state.eligibilityFailureReason).toBeUndefined();
  expect(JSON.stringify(state)).not.toContain(message);
});
it('does not interpret offers with an unknown period as months', async () => {
  await expect(
    refreshOxygenEligibility(
      context,
      { applicationReference: 'application' },
      {
        call: vi.fn().mockResolvedValue({
          ...response,
          offers: [{ loan_amount: 68000, tenor: 1 }],
        }),
      }
    )
  ).rejects.toThrow();
});
it('rejects ambiguous offers for the same repayment period', async () => {
  await expect(
    refreshOxygenEligibility(
      context,
      { applicationReference: 'application' },
      {
        call: vi.fn().mockResolvedValue({
          ...response,
          tenure_unit: 'Monthly',
          offers: [
            { loan_amount: 68000, tenor: 1 },
            { loan_amount: 131000, tenor: 1 },
          ],
        }),
      }
    )
  ).rejects.toThrow();
});
it('retains strict eligibility success behavior', async () => {
  const state: OxygenProviderState = { applicationReference: 'application' };
  await refreshOxygenEligibility(context, state, {
    call: vi.fn().mockResolvedValue(response),
  });
  expect(state).toMatchObject({
    eligibilityStatus: 'completed',
    eligible: true,
    eligibleAmount: 200000,
    minimumAmount: 10000,
    maxTenure: 6,
  });
});
it('identifies the mismatched binding without including either reference value', async () => {
  await expect(
    refreshOxygenEligibility(
      context,
      { applicationReference: 'different' },
      { call: vi.fn().mockResolvedValue(response) }
    )
  ).rejects.toMatchObject({
    reason: 'reference_mismatch',
    fields: ['loan_request_reference'],
  });
});
it('identifies a missing required limit without allowing booking', async () => {
  await expect(
    refreshOxygenEligibility(
      context,
      { applicationReference: 'application' },
      {
        call: vi.fn().mockResolvedValue({ ...response, max_tenure: undefined }),
      }
    )
  ).rejects.toMatchObject({
    reason: 'required_field_missing',
    fields: ['max_tenure'],
  });
});
it.each([
  [undefined, 10000],
  [20000, 20000],
])('uses the confirmed minimum only when Oxygen omits it (%s)', async (minimum, expected) => {
  const state: OxygenProviderState = { applicationReference: 'application' };
  await refreshOxygenEligibility(context, state, {
    call: vi
      .fn()
      .mockResolvedValue({ ...response, minimum_loan_amount: minimum }),
  });
  expect(state.minimumAmount).toBe(expected);
  expect(state.eligible).toBe(true);
});
it.each([
  null,
  0,
  -100,
  '10000',
])('rejects an invalid returned minimum instead of substituting a default (%s)', async (minimum) => {
  await expect(
    refreshOxygenEligibility(
      context,
      { applicationReference: 'application' },
      {
        call: vi
          .fn()
          .mockResolvedValue({ ...response, minimum_loan_amount: minimum }),
      }
    )
  ).rejects.toThrow();
});
