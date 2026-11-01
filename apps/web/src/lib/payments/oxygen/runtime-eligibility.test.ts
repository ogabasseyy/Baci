import { expect, it, vi } from 'vitest';
import type {
  OxygenProviderContext,
  OxygenProviderState,
} from '@/schemas/oxygen-runtime';
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
