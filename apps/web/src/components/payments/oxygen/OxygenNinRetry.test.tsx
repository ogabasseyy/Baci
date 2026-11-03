import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import { OxygenGuidedVerification } from './OxygenGuidedVerification';
import { OxygenWorkflowError } from './OxygenWorkflowError';

const snapshot: OxygenRuntimeSnapshot = {
  workflowId: '60000000-0000-4000-8000-000000000001',
  stage: 'kyc_required',
  version: 2,
  environment: 'staging',
  executionEnabled: true,
  ninRetryAllowed: true,
  state: {
    validated: true,
    eligible: true,
    kyc: {
      phone_status: 'DONE',
      bvn_status: 'DONE',
      selfie_status: 'DONE',
      nin_status: 'NOT_DONE',
      bank_status: 'NOT_DONE',
      address_status: 'NOT_DONE',
    },
  },
  approvalOtpReady: false,
  checkoutPhone: '',
  checkoutAddress: {},
  activationEnabled: false,
  settlementEnabled: false,
};

it('offers explicit NIN retry after reload without automatically repeating it', async () => {
  const submit = vi.fn().mockResolvedValue(false);
  render(
    <OxygenGuidedVerification
      snapshot={snapshot}
      busy={false}
      error=""
      submit={submit}
    />
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Try NIN check again' }));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledExactlyOnceWith({ action: 'validate_nin' })
  );
});

it('offers a NIN retry on the failed action screen only when proven safe', async () => {
  const submit = vi.fn().mockResolvedValue(false);
  const refresh = vi.fn();
  const view = render(
    <OxygenWorkflowError
      snapshot={snapshot}
      action="validate_nin"
      activeLoan={false}
      error="failed"
      busy={false}
      submit={submit}
      refresh={refresh}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Try NIN check again' }));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledExactlyOnceWith({ action: 'validate_nin' })
  );
  view.rerender(
    <OxygenWorkflowError
      snapshot={{ ...snapshot, ninRetryAllowed: false }}
      action="validate_nin"
      activeLoan={false}
      error="failed"
      busy={false}
      submit={submit}
      refresh={refresh}
    />
  );
  expect(
    screen.getByRole('button', { name: 'Check for an update' })
  ).toBeInTheDocument();
});

it.each([
  'queued',
  'executing',
  'indeterminate',
] as const)('never offers retry for %s requests', (status) => {
  const submit = vi.fn();
  render(
    <OxygenWorkflowError
      snapshot={{
        ...snapshot,
        pending: {
          action: 'validate_nin',
          status,
          idempotencyKey: snapshot.workflowId,
        },
      }}
      action="validate_nin"
      activeLoan={false}
      error="failed"
      busy={false}
      submit={submit}
      refresh={vi.fn()}
    />
  );
  expect(
    screen.queryByRole('button', { name: 'Try NIN check again' })
  ).toBeNull();
  expect(submit).not.toHaveBeenCalled();
});

it('does not submit automatically if the retry proof could not be read', async () => {
  const submit = vi.fn();
  render(
    <OxygenGuidedVerification
      snapshot={{ ...snapshot, ninRetryAllowed: null }}
      busy={false}
      error=""
      submit={submit}
    />
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Check for an update' }));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledExactlyOnceWith({ action: 'refresh_kyc' })
  );
});
