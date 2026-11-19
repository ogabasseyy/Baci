import { render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import { OxygenGuidedVerification } from './OxygenGuidedVerification';

const base: OxygenRuntimeSnapshot = {
  workflowId: '60000000-0000-4000-8000-000000000001',
  stage: 'eligibility_required',
  version: 2,
  environment: 'staging',
  executionEnabled: true,
  state: { validated: true },
  approvalOtpReady: false,
  checkoutPhone: '',
  checkoutAddress: {},
  activationEnabled: false,
  settlementEnabled: false,
};
const kyc = {
  bvn_status: 'DONE',
  nin_status: 'DONE',
  bank_status: 'DONE',
  phone_status: 'DONE',
  selfie_status: 'NOT_DONE',
  address_status: 'NOT_DONE',
} as const;

it('renews an expired selfie link instead of opening it', async () => {
  const submit = vi.fn().mockResolvedValue(true);
  const token = `header.${btoa(JSON.stringify({ exp: 1 }))}.signature`;
  render(
    <OxygenGuidedVerification
      snapshot={{
        ...base,
        stage: 'kyc_required',
        state: {
          validated: true,
          kyc,
          selfieUrl: `https://verify.example/?securityToken=${token}`,
        },
      }}
      busy={false}
      error=""
      submit={submit}
    />
  );
  expect(
    screen.queryByRole('link', { name: 'Continue to selfie verification' })
  ).toBeNull();
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith({ action: 'selfie_link' })
  );
});

it('does not renew an expired selfie link while another command is pending', async () => {
  const submit = vi.fn();
  const token = `header.${btoa(JSON.stringify({ exp: 1 }))}.signature`;
  render(
    <OxygenGuidedVerification
      snapshot={{
        ...base,
        stage: 'kyc_required',
        pending: {
          action: 'validate_nin',
          status: 'indeterminate',
          idempotencyKey: base.workflowId,
        },
        state: {
          validated: true,
          kyc,
          selfieUrl: `https://verify.example/?securityToken=${token}`,
        },
      }}
      busy={false}
      error=""
      submit={submit}
    />
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(submit).not.toHaveBeenCalled();
});

it('checks identity before requesting eligibility, without customer controls', async () => {
  const submit = vi.fn().mockResolvedValue(true);
  const view = render(
    <OxygenGuidedVerification
      snapshot={base}
      busy={false}
      error=""
      submit={submit}
    />
  );
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith({ action: 'refresh_kyc' })
  );
  view.rerender(
    <OxygenGuidedVerification
      snapshot={{
        ...base,
        stage: 'kyc_required',
        state: { validated: true, kyc: { ...kyc, selfie_status: 'DONE' } },
      }}
      busy={false}
      error=""
      submit={submit}
    />
  );
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith({ action: 'refresh_eligibility' })
  );
  expect(screen.queryByRole('button')).toBeNull();
  expect(submit).toHaveBeenCalledTimes(2);
});

it('shows just the selfie action when customer input is required', async () => {
  const submit = vi.fn().mockResolvedValue(true);
  render(
    <OxygenGuidedVerification
      snapshot={{
        ...base,
        stage: 'kyc_required',
        state: {
          validated: true,
          eligible: true,
          kyc,
          selfieUrl: 'https://verify.example/selfie',
        },
      }}
      busy={false}
      error=""
      submit={submit}
    />
  );
  expect(
    screen.getByRole('link', { name: 'Continue to selfie verification' })
  ).toHaveAttribute('href', 'https://verify.example/selfie');
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByText('Phone verified')).toBeNull();
  expect(submit).not.toHaveBeenCalled();
});

it.each([
  'busy',
  'error',
  'pending',
  'disabled',
  'plan',
] as const)('does not dispatch checks while %s', async (reason) => {
  const submit = vi.fn().mockResolvedValue(true);
  render(
    <OxygenGuidedVerification
      snapshot={{
        ...base,
        executionEnabled: reason !== 'disabled',
        stage: reason === 'plan' ? 'plan_required' : base.stage,
        pending:
          reason === 'pending'
            ? {
                action: 'refresh_eligibility',
                status: 'indeterminate',
                idempotencyKey: base.workflowId,
              }
            : null,
      }}
      busy={reason === 'busy'}
      error={reason === 'error' ? 'Unable to confirm' : ''}
      submit={submit}
    />
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(submit).not.toHaveBeenCalled();
});

it('prepares selfie first, then checks eligibility before NIN', async () => {
  const submit = vi.fn().mockResolvedValue(true);
  const snapshot: OxygenRuntimeSnapshot = {
    ...base,
    stage: 'kyc_required',
    state: { validated: true, kyc: { ...kyc, nin_status: 'NOT_DONE' } },
  };
  const view = render(
    <OxygenGuidedVerification
      snapshot={snapshot}
      busy={false}
      error=""
      submit={submit}
    />
  );
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith({ action: 'selfie_link' })
  );
  expect(submit).not.toHaveBeenCalledWith({ action: 'validate_nin' });
  view.rerender(
    <OxygenGuidedVerification
      snapshot={{
        ...snapshot,
        version: 3,
        state: {
          ...snapshot.state,
          selfieUrl: 'https://verify.example/selfie',
        },
      }}
      busy={false}
      error=""
      submit={submit}
    />
  );
  expect(
    screen.getByRole('link', { name: 'Continue to selfie verification' })
  ).toBeVisible();
  expect(submit).not.toHaveBeenCalledWith({ action: 'validate_nin' });
  view.rerender(
    <OxygenGuidedVerification
      snapshot={{
        ...snapshot,
        version: 4,
        state: {
          ...snapshot.state,
          kyc: { ...kyc, nin_status: 'NOT_DONE', selfie_status: 'DONE' },
        },
      }}
      busy={false}
      error=""
      submit={submit}
    />
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(submit).not.toHaveBeenCalledWith({ action: 'validate_nin' });
  expect(submit).toHaveBeenCalledWith({ action: 'refresh_eligibility' });
  expect(submit).toHaveBeenCalledTimes(2);
});
