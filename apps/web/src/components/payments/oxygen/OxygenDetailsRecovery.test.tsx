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
] as const)('explicitly resumes a %s loan-details read with the correct key', async (status) => {
  const workflowId = '60000000-0000-4000-8000-000000000001';
  const reference = '70000000-0000-4000-8000-000000000001';
  const pending = {
    workflowId,
    stage: 'booked',
    version: 3,
    environment: 'staging',
    executionEnabled: true,
    state: { applicationReference: workflowId, bookingReference: reference },
    pending: { action: 'refresh_details', status, idempotencyKey: reference },
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
        stage: 'approval_required',
      });
    }
    return Response.json({ draft: null, version: 0 });
  });
  render(<OxygenProviderFlow orderId={workflowId} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Check for an update' })
  );
  await waitFor(() => expect(commands).toHaveLength(1));
  expect(commands[0].command.action).toBe('refresh_details');
  if (status === 'queued') expect(commands[0].idempotencyKey).toBe(reference);
  else expect(commands[0].idempotencyKey).not.toBe(reference);
});
