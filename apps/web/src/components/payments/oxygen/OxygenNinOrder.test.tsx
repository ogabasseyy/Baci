import { render, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import { OxygenGuidedVerification } from './OxygenGuidedVerification';

const snapshot: OxygenRuntimeSnapshot = {
  workflowId: '60000000-0000-4000-8000-000000000001',
  stage: 'kyc_required',
  version: 4,
  environment: 'staging',
  executionEnabled: true,
  activationEnabled: false,
  settlementEnabled: false,
  approvalOtpReady: false,
  checkoutPhone: '',
  checkoutAddress: {},
  state: {
    validated: true,
    eligible: true,
    eligibilityStatus: 'completed',
    kyc: {
      phone_status: 'DONE',
      bvn_status: 'DONE',
      selfie_status: 'DONE',
      nin_status: 'NOT_DONE',
      bank_status: 'DONE',
      address_status: 'NOT_DONE',
    },
  },
};
it('starts NIN once after successful eligibility and never books automatically', async () => {
  const submit = vi.fn().mockResolvedValue(true);
  const view = render(
    <OxygenGuidedVerification
      snapshot={snapshot}
      busy={false}
      error=""
      submit={submit}
    />
  );
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith({ action: 'validate_nin' })
  );
  view.rerender(
    <OxygenGuidedVerification
      snapshot={{ ...snapshot, version: 5 }}
      busy={false}
      error=""
      submit={submit}
    />
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(submit).toHaveBeenCalledTimes(1);
});
it('does not resubmit a processing NIN', async () => {
  const submit = vi.fn();
  render(
    <OxygenGuidedVerification
      snapshot={{
        ...snapshot,
        state: {
          ...snapshot.state,
          kyc: {
            phone_status: 'DONE',
            bvn_status: 'DONE',
            selfie_status: 'DONE',
            nin_status: 'PROCESSING',
            bank_status: 'DONE',
            address_status: 'NOT_DONE',
          },
        },
      }}
      busy={false}
      error=""
      submit={submit}
    />
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(submit).not.toHaveBeenCalledWith({ action: 'validate_nin' });
});
it.each([
  'failed',
  'pending',
] as const)('never starts NIN for %s eligibility', async (eligibilityStatus) => {
  const submit = vi.fn();
  render(
    <OxygenGuidedVerification
      snapshot={{
        ...snapshot,
        state: { ...snapshot.state, eligible: undefined, eligibilityStatus },
      }}
      busy={false}
      error=""
      submit={submit}
    />
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(submit).not.toHaveBeenCalledWith({ action: 'validate_nin' });
});
