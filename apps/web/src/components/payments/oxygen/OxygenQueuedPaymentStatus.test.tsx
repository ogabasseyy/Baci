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

import { OxygenProviderFlow } from './OxygenProviderFlow';

it.each([
  'payment_required',
  'ready_for_activation',
] as const)('resumes a queued payment status check at %s using its original key', async (stage) => {
  const workflowId = '60000000-0000-4000-8000-000000000001';
  const key = '70000000-0000-4000-8000-000000000001';
  const pending = {
    workflowId,
    stage,
    version: 3,
    environment: 'staging',
    executionEnabled: true,
    state: {
      applicationReference: workflowId,
      bookingReference: key,
      paymentComplete: stage === 'ready_for_activation',
      setupComplete: stage === 'ready_for_activation',
    },
    pending: {
      action: 'refresh_payment_setup',
      status: 'queued',
      idempotencyKey: key,
    },
    approvalOtpReady: false,
    activationEnabled: false,
    settlementEnabled: false,
  };
  const commands: { idempotencyKey: string; command: { action: string } }[] =
    [];
  fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/workflows'))
      return Response.json({ workflow: { id: workflowId } });
    if (url.includes('/workflows/actions?')) return Response.json(pending);
    if (url.endsWith('/workflows/actions') && options?.method === 'POST') {
      commands.push(JSON.parse(String(options.body)));
      return Response.json({ ...pending, version: 4, pending: null });
    }
    return Response.json({ draft: null, version: 0 });
  });
  render(<OxygenProviderFlow orderId={workflowId} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Check for an update' })
  );
  await waitFor(() => expect(commands).toHaveLength(1));
  expect(commands[0]).toMatchObject({
    idempotencyKey: key,
    command: { action: 'refresh_payment_setup' },
  });
});

it('rechecks an executing payment read with a fresh key after an active lease conflict', async () => {
  const workflowId = '60000000-0000-4000-8000-000000000001';
  const key = '70000000-0000-4000-8000-000000000001';
  const pending = {
    workflowId,
    stage: 'payment_required',
    version: 3,
    environment: 'staging',
    executionEnabled: true,
    state: { applicationReference: workflowId, bookingReference: key },
    pending: {
      action: 'refresh_payment_setup',
      status: 'executing',
      idempotencyKey: key,
    },
    approvalOtpReady: false,
    activationEnabled: false,
    settlementEnabled: false,
  };
  const commands: { idempotencyKey: string; command: { action: string } }[] =
    [];
  fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/workflows'))
      return Response.json({ workflow: { id: workflowId } });
    if (url.includes('/workflows/actions?')) return Response.json(pending);
    if (url.endsWith('/workflows/actions') && options?.method === 'POST') {
      commands.push(JSON.parse(String(options.body)));
      return commands.length === 1
        ? Response.json({}, { status: 409 })
        : Response.json({ ...pending, version: 4, pending: null });
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
    'refresh_payment_setup',
    'refresh_payment_setup',
  ]);
  expect(commands[0].idempotencyKey).not.toBe(commands[1].idempotencyKey);
  expect(commands[0].idempotencyKey).not.toBe(key);
});

it.each([
  { action: 'refresh_payment_setup', status: 'indeterminate' },
  { action: 'approve_booking', status: 'executing' },
] as const)('keeps $action $status on saved-state reads only', async (pendingCommand) => {
  const workflowId = '60000000-0000-4000-8000-000000000001';
  const key = '70000000-0000-4000-8000-000000000001';
  const pending = {
    workflowId,
    stage: 'payment_required',
    version: 3,
    environment: 'staging',
    executionEnabled: true,
    state: { applicationReference: workflowId, bookingReference: key },
    pending: { ...pendingCommand, idempotencyKey: key },
    approvalOtpReady: false,
    activationEnabled: false,
    settlementEnabled: false,
  };
  const commands: unknown[] = [];
  let reads = 0;
  fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/workflows'))
      return Response.json({ workflow: { id: workflowId } });
    if (url.includes('/workflows/actions?')) {
      reads++;
      return Response.json(pending);
    }
    if (url.endsWith('/workflows/actions') && options?.method === 'POST')
      commands.push(options.body);
    return Response.json({ draft: null, version: 0 });
  });
  render(<OxygenProviderFlow orderId={workflowId} />);
  const button = await screen.findByRole('button', {
    name: 'Check for an update',
  });
  const before = reads;
  fireEvent.click(button);
  await waitFor(() => expect(reads).toBeGreaterThan(before));
  expect(commands).toHaveLength(0);
});
