import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mocks.fetch }));
vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: vi.fn(),
}));
vi.mock('./use-oxygen-confirmation-updates', () => ({
  useOxygenConfirmationUpdates: vi.fn(),
}));

import { OxygenProviderFlow } from './OxygenProviderFlow';

it('allows an interrupted address read to be checked again with a fresh key after an active-lease conflict', async () => {
  const workflowId = '60000000-0000-4000-8000-000000000001';
  const reference = '70000000-0000-4000-8000-000000000001';
  const pending = {
    workflowId,
    stage: 'booked',
    version: 3,
    environment: 'staging',
    executionEnabled: true,
    state: {
      applicationReference: workflowId,
      bookingReference: reference,
      kyc: {
        address_status: 'PROCESSING',
        bvn_status: 'DONE',
        nin_status: 'DONE',
        bank_status: 'DONE',
        phone_status: 'DONE',
        selfie_status: 'DONE',
      },
    },
    pending: {
      action: 'refresh_kyc',
      status: 'executing',
      idempotencyKey: reference,
    },
    approvalOtpReady: false,
    activationEnabled: false,
    settlementEnabled: false,
  };
  const commands: { idempotencyKey: string; command: { action: string } }[] =
    [];
  mocks.fetch.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/workflows'))
      return Response.json({ workflow: { id: workflowId } });
    if (url.includes('/workflows/actions?')) return Response.json(pending);
    if (url.endsWith('/workflows/actions') && options?.method === 'POST') {
      commands.push(JSON.parse(String(options.body)));
      return commands.length === 1
        ? Response.json({}, { status: 409 })
        : Response.json({
            ...pending,
            version: 4,
            pending: null,
            stage: 'approval_required',
            state: {
              ...pending.state,
              kyc: { ...pending.state.kyc, address_status: 'DONE' },
            },
          });
    }
    return Response.json({ draft: null, version: 0 });
  });
  render(<OxygenProviderFlow orderId={workflowId} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Check for an update' })
  );
  await waitFor(() => expect(commands).toHaveLength(1));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Check for an update' })
    ).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'Check for an update' }));
  await waitFor(() => expect(commands).toHaveLength(2));
  expect(commands.map(({ command }) => command.action)).toEqual([
    'refresh_kyc',
    'refresh_kyc',
  ]);
  expect(commands[0].idempotencyKey).not.toBe(commands[1].idempotencyKey);
  await waitFor(() =>
    expect(
      screen.queryByText('Oxygen is reviewing your address')
    ).not.toBeInTheDocument()
  );
});

it('resumes the same queued address read without creating a new command key', async () => {
  const workflowId = '60000000-0000-4000-8000-000000000001';
  const reference = '70000000-0000-4000-8000-000000000001';
  const pending = {
    workflowId,
    stage: 'booked',
    version: 3,
    environment: 'staging',
    executionEnabled: true,
    state: {
      applicationReference: workflowId,
      bookingReference: reference,
      kyc: {
        address_status: 'PROCESSING',
        bvn_status: 'DONE',
        nin_status: 'DONE',
        bank_status: 'DONE',
        phone_status: 'DONE',
        selfie_status: 'DONE',
      },
    },
    pending: {
      action: 'refresh_kyc',
      status: 'queued',
      idempotencyKey: reference,
    },
    approvalOtpReady: false,
    activationEnabled: false,
    settlementEnabled: false,
  };
  const commands: { idempotencyKey: string; command: { action: string } }[] =
    [];
  mocks.fetch.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/workflows'))
      return Response.json({ workflow: { id: workflowId } });
    if (url.includes('/workflows/actions?')) return Response.json(pending);
    if (url.endsWith('/workflows/actions') && options?.method === 'POST') {
      commands.push(JSON.parse(String(options.body)));
      return Response.json({
        ...pending,
        version: 4,
        pending: null,
        stage: 'approval_required',
        state: {
          ...pending.state,
          kyc: { ...pending.state.kyc, address_status: 'DONE' },
        },
      });
    }
    return Response.json({ draft: null, version: 0 });
  });
  render(<OxygenProviderFlow orderId={workflowId} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Check for an update' })
  );
  await waitFor(() =>
    expect(commands).toEqual([
      {
        workflowId,
        version: 3,
        idempotencyKey: reference,
        command: { action: 'refresh_kyc' },
      },
    ])
  );
  await waitFor(() =>
    expect(
      screen.queryByText('Oxygen is reviewing your address')
    ).not.toBeInTheDocument()
  );
});
