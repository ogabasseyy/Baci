import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import { OxygenWorkflowError } from './OxygenWorkflowError';

const kyc = {
  phone_status: 'DONE',
  bvn_status: 'DONE',
  selfie_status: 'DONE',
  nin_status: 'NOT_DONE',
  bank_status: 'NOT_DONE',
  address_status: 'NOT_DONE',
} as const;

const snapshot: OxygenRuntimeSnapshot = {
  workflowId: '60000000-0000-4000-8000-000000000091',
  stage: 'kyc_required',
  version: 12,
  environment: 'staging',
  executionEnabled: true,
  state: {
    validated: true,
    eligibilityStatus: 'failed',
    kyc,
  },
  checkoutPhone: '',
  checkoutAddress: {},
  approvalOtpReady: false,
  activationEnabled: false,
  settlementEnabled: false,
};

it('shows text loading immediately, blocks duplicate clicks and releases recovery after another failure', async () => {
  let finish: (value: boolean) => void = () => {};
  const submit = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      })
  );
  const refresh = vi.fn();
  render(
    <OxygenWorkflowError
      snapshot={snapshot}
      action="refresh_eligibility"
      activeLoan={false}
      error="unavailable"
      busy={false}
      submit={submit}
      refresh={refresh}
    />
  );
  const retry = screen.getByRole('button', { name: 'Try again' });
  fireEvent.click(retry);
  fireEvent.click(retry);
  expect(
    screen.getByRole('button', { name: 'Checking your payment options…' })
  ).toBeDisabled();
  expect(submit).toHaveBeenCalledExactlyOnceWith({
    action: 'refresh_eligibility',
  });
  expect(refresh).not.toHaveBeenCalled();
  await act(async () => finish(false));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Your details and verification are saved.'
  );
  expect(submit).toHaveBeenCalledTimes(1);
});

it.each([
  [
    'uncertain pending command',
    {
      pending: {
        action: 'book',
        status: 'indeterminate',
        idempotencyKey: snapshot.workflowId,
      },
    },
  ],
  [
    'queued command',
    {
      pending: {
        action: 'refresh_eligibility',
        status: 'queued',
        idempotencyKey: snapshot.workflowId,
      },
    },
  ],
  ['disabled execution', { executionEnabled: false }],
  [
    'existing booking',
    { state: { ...snapshot.state, bookingReference: snapshot.workflowId } },
  ],
  [
    'incomplete selfie',
    {
      state: {
        ...snapshot.state,
        kyc: { ...kyc, selfie_status: 'NOT_DONE' },
      },
    },
  ],
  ['confirmed eligibility', { state: { ...snapshot.state, eligible: true } }],
] satisfies [
  string,
  Partial<OxygenRuntimeSnapshot>,
][])('uses status-only recovery for %s', async (_name, changes) => {
  const submit = vi.fn();
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(
    <OxygenWorkflowError
      snapshot={{ ...snapshot, ...changes }}
      action="refresh_eligibility"
      activeLoan={false}
      error="unavailable"
      busy={false}
      submit={submit}
      refresh={refresh}
    />
  );
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Check for an update' }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(submit).not.toHaveBeenCalled();
});
