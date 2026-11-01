import { expect, it } from 'vitest';
import { oxygenActionAllowed, stageFor } from './runtime-policy';

const context = {
  stage: 'kyc_required' as const,
  environment: 'staging' as const,
  state: {
    applicationReference: '60000000-0000-4000-8000-000000000001',
    validated: true,
    kyc: {
      phone_status: 'DONE' as const,
      bvn_status: 'DONE' as const,
      selfie_status: 'DONE' as const,
      nin_status: 'NOT_DONE' as const,
      bank_status: 'NOT_DONE' as const,
      address_status: 'NOT_DONE' as const,
    },
  },
};
it('permits eligibility before NIN and bank completion but rejects NIN before eligibility', () => {
  expect(oxygenActionAllowed(context, { action: 'refresh_eligibility' })).toBe(
    true
  );
  expect(oxygenActionAllowed(context, { action: 'validate_nin' })).toBe(false);
});
it('requires successful eligibility before NIN and confirmed NIN and bank before booking', () => {
  const eligible = { ...context, state: { ...context.state, eligible: true } };
  expect(oxygenActionAllowed(eligible, { action: 'validate_nin' })).toBe(true);
  expect(stageFor(eligible.state)).toBe('kyc_required');
  expect(
    oxygenActionAllowed(
      { ...eligible, stage: 'plan_required' },
      { action: 'book', equityPercentage: 25, tenure: 3 }
    )
  ).toBe(false);
  const complete = {
    ...eligible.state,
    kyc: {
      ...eligible.state.kyc,
      nin_status: 'DONE' as const,
      bank_status: 'DONE' as const,
    },
  };
  expect(stageFor(complete)).toBe('plan_required');
});
