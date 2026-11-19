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
  'queued',
  'executing',
] as const)('handles a %s eligibility command with a fresh key only for interrupted status reads', async (status) => {
  const workflowId = '60000000-0000-4000-8000-000000000001';
  const key = '70000000-0000-4000-8000-000000000001';
  const pending = {
    workflowId,
    stage: 'eligibility_required',
    version: 3,
    environment: 'staging',
    executionEnabled: true,
    state: {
      applicationReference: workflowId,
      validated: true,
      kyc: {
        address_status: 'NOT_DONE',
        bvn_status: 'DONE',
        nin_status: 'NOT_DONE',
        bank_status: 'NOT_DONE',
        phone_status: 'DONE',
        selfie_status: 'DONE',
      },
    },
    pending: { action: 'refresh_eligibility', status, idempotencyKey: key },
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
      return Response.json({
        ...pending,
        version: 4,
        pending: null,
        state: { ...pending.state, eligible: true },
      });
    }
    return Response.json({ draft: null, version: 0 });
  });
  render(<OxygenProviderFlow orderId={workflowId} />);
  const button = await screen.findByRole('button', {
    name: 'Check for an update',
  });
  fireEvent.click(button);
  await waitFor(() => expect(commands).toHaveLength(1));
  expect(commands[0]).toMatchObject({
    command: { action: 'refresh_eligibility' },
  });
  if (status === 'queued') expect(commands[0].idempotencyKey).toBe(key);
  else expect(commands[0].idempotencyKey).not.toBe(key);
});
