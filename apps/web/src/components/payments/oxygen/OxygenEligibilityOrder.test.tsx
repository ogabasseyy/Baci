import { render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import { OxygenGuidedVerification } from './OxygenGuidedVerification';

const snapshot: OxygenRuntimeSnapshot = {
  workflowId: '60000000-0000-4000-8000-000000000001',
  stage: 'eligibility_required',
  version: 3,
  environment: 'staging',
  executionEnabled: true,
  approvalOtpReady: false,
  activationEnabled: false,
  settlementEnabled: false,
  checkoutPhone: '',
  checkoutAddress: {},
  state: {
    validated: true,
    kyc: {
      phone_status: 'DONE',
      bvn_status: 'DONE',
      nin_status: 'DONE',
      selfie_status: 'DONE',
      bank_status: 'NOT_DONE',
      address_status: 'NOT_DONE',
    },
  },
};

it('requests eligibility after BVN and selfie while NIN and bank confirmation are not done', async () => {
  const submit = vi.fn().mockResolvedValue(true);
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
            nin_status: 'NOT_DONE',
            bank_status: 'NOT_DONE',
            address_status: 'NOT_DONE',
          },
        },
      }}
      busy={false}
      error=""
      submit={submit}
    />
  );
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith({ action: 'refresh_eligibility' })
  );
  expect(submit).not.toHaveBeenCalledWith({ action: 'refresh_kyc' });
  expect(screen.queryByText('Confirming your bank details')).toBeNull();
});

it('reads bank status after eligibility succeeds without booking or changing identity status', async () => {
  const submit = vi.fn().mockResolvedValue(true);
  render(
    <OxygenGuidedVerification
      snapshot={{
        ...snapshot,
        state: {
          ...snapshot.state,
          eligible: true,
          eligibilityStatus: 'completed',
        },
      }}
      busy={false}
      error=""
      submit={submit}
    />
  );
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith({ action: 'refresh_kyc' })
  );
  expect(submit).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole('heading', { name: 'Confirming your bank details' })
  ).toBeVisible();
});

it.each([
  'phone_status',
  'bvn_status',
  'selfie_status',
] as const)('does not check eligibility with an incomplete %s', async (key) => {
  if (!snapshot.state.kyc) throw new Error('Missing identity fixture');
  const submit = vi.fn().mockResolvedValue(true);
  render(
    <OxygenGuidedVerification
      snapshot={{
        ...snapshot,
        state: {
          ...snapshot.state,
          kyc: { ...snapshot.state.kyc, [key]: 'NOT_DONE' },
        },
      }}
      busy={false}
      error=""
      submit={submit}
    />
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(submit).not.toHaveBeenCalledWith({ action: 'refresh_eligibility' });
});

it('stops automatic requests and loading after an eligibility error', () => {
  const submit = vi.fn();
  render(
    <OxygenGuidedVerification
      snapshot={snapshot}
      busy={false}
      error="Unable to confirm"
      submit={submit}
    />
  );
  expect(submit).not.toHaveBeenCalled();
  expect(screen.queryByRole('status')).toBeNull();
});
