import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const fetcher = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: fetcher }));
vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: vi.fn(),
}));
vi.mock('./use-oxygen-confirmation-updates', () => ({
  useOxygenConfirmationUpdates: vi.fn(),
}));

import { oxygenRuntimeSnapshotSchema } from '@/schemas/oxygen-runtime-view';
import { OxygenProviderFlow } from './OxygenProviderFlow';
import { pendingReadRecovery } from './oxygen-read-recovery';

const workflowId = '60000000-0000-4000-8000-000000000001';
const key = '70000000-0000-4000-8000-000000000001';
const base = {
  workflowId,
  version: 7,
  environment: 'staging',
  executionEnabled: true,
  state: { applicationReference: workflowId, validated: true },
  approvalOtpReady: false,
  activationEnabled: false,
  settlementEnabled: false,
};

it.each([
  ['application_required', 'queued'],
  ['eligibility_required', 'queued'],
  ['eligibility_required', 'executing'],
  ['kyc_required', 'queued'],
  ['kyc_required', 'executing'],
  ['plan_required', 'queued'],
  ['plan_required', 'executing'],
  ['booked', 'queued'],
  ['booked', 'executing'],
  ['approval_required', 'queued'],
  ['approval_required', 'executing'],
  ['payment_required', 'queued'],
  ['ready_for_activation', 'executing'],
] as const)('recovers %s KYC in %s without another command', async (stage, status) => {
  const hasBooking = [
    'booked',
    'approval_required',
    'payment_required',
    'ready_for_activation',
  ].includes(stage);
  const pending = {
    ...base,
    stage,
    state: {
      ...base.state,
      ...(hasBooking ? { bookingReference: key } : {}),
      ...(stage === 'approval_required'
        ? {
            kyc: {
              address_status: 'PROCESSING',
              bvn_status: 'DONE',
              nin_status: 'DONE',
              bank_status: 'DONE',
              phone_status: 'DONE',
              selfie_status: 'DONE',
            },
          }
        : {}),
    },
    pending: { action: 'refresh_kyc', status, idempotencyKey: key },
  };
  const commands: {
    version: number;
    idempotencyKey: string;
    command: { action: string };
  }[] = [];
  fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/workflows'))
      return Response.json({ workflow: { id: workflowId } });
    if (url.includes('/workflows/actions?')) return Response.json(pending);
    if (url.endsWith('/workflows/actions') && options?.method === 'POST') {
      commands.push(JSON.parse(String(options.body)));
      return Response.json(pending);
    }
    return Response.json({ draft: null, version: 0 });
  });
  render(<OxygenProviderFlow orderId={workflowId} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Check for an update' })
  );
  await waitFor(() => expect(commands).toHaveLength(1));
  expect(commands[0]).toMatchObject({
    version: 7,
    command: { action: 'refresh_kyc' },
  });
  if (status === 'queued') expect(commands[0].idempotencyKey).toBe(key);
  else expect(commands[0].idempotencyKey).not.toBe(key);
});

it.each([
  {
    stage: 'kyc_required',
    action: 'refresh_kyc',
    status: 'indeterminate',
    applicationReference: workflowId,
  },
  {
    stage: 'kyc_required',
    action: 'validate_nin',
    status: 'executing',
    applicationReference: workflowId,
  },
  {
    stage: 'kyc_required',
    action: 'refresh_kyc',
    status: 'queued',
    applicationReference: undefined,
  },
  {
    stage: 'reconciliation_required',
    action: 'refresh_kyc',
    status: 'executing',
    applicationReference: workflowId,
  },
  {
    stage: 'activated',
    action: 'refresh_kyc',
    status: 'queued',
    applicationReference: workflowId,
  },
] as const)('refuses unsafe pending recovery: $stage $action $status', ({
  stage,
  action,
  status,
  applicationReference,
}) => {
  const snapshot = oxygenRuntimeSnapshotSchema.parse({
    ...base,
    stage,
    state: { ...base.state, applicationReference },
    pending: { action, status, idempotencyKey: key },
  });
  expect(pendingReadRecovery(snapshot)).toBeNull();
});
