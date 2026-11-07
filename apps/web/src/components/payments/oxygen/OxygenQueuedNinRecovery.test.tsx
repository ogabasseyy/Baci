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
  'indeterminate',
] as const)('handles a %s NIN command without replaying an uncertain request', async (status) => {
  const workflowId = '60000000-0000-4000-8000-000000000001';
  const key = '70000000-0000-4000-8000-000000000001';
  const pending = {
    workflowId,
    stage: 'kyc_required',
    version: 3,
    environment: 'staging',
    executionEnabled: true,
    state: {
      applicationReference: workflowId,
      validated: true,
      eligible: true,
      kyc: {
        address_status: 'NOT_DONE',
        bvn_status: 'DONE',
        nin_status: 'NOT_DONE',
        bank_status: 'NOT_DONE',
        phone_status: 'DONE',
        selfie_status: 'DONE',
      },
    },
    pending: { action: 'validate_nin', status, idempotencyKey: key },
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
    name: status === 'queued' ? 'Continue NIN check' : 'Check for an update',
  });
  const statusReadsBeforeClick = fetcher.mock.calls.filter(([url]) =>
    String(url).includes('/workflows/actions?')
  ).length;
  expect(commands).toHaveLength(0);
  fireEvent.click(button);
  if (status === 'queued') {
    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toMatchObject({
      idempotencyKey: key,
      command: { action: 'validate_nin' },
    });
  } else {
    await waitFor(() =>
      expect(
        fetcher.mock.calls.filter(([url]) =>
          String(url).includes('/workflows/actions?')
        ).length
      ).toBeGreaterThan(statusReadsBeforeClick)
    );
    expect(commands).toHaveLength(0);
  }
});

it('shows a safe failure, allows same-key retry, and ignores duplicate clicks', async () => {
  const workflowId = '60000000-0000-4000-8000-000000000001';
  const key = '70000000-0000-4000-8000-000000000001';
  const pending = {
    workflowId,
    stage: 'kyc_required',
    version: 3,
    environment: 'staging',
    executionEnabled: true,
    state: {
      applicationReference: workflowId,
      validated: true,
      eligible: true,
      kyc: {
        address_status: 'NOT_DONE',
        bvn_status: 'DONE',
        nin_status: 'NOT_DONE',
        bank_status: 'NOT_DONE',
        phone_status: 'DONE',
        selfie_status: 'DONE',
      },
    },
    pending: { action: 'validate_nin', status: 'queued', idempotencyKey: key },
    approvalOtpReady: false,
    activationEnabled: false,
    settlementEnabled: false,
  };
  const keys: string[] = [];
  let release!: (response: Response) => void;
  fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/workflows'))
      return Response.json({ workflow: { id: workflowId } });
    if (url.includes('/workflows/actions?')) return Response.json(pending);
    if (url.endsWith('/workflows/actions') && options?.method === 'POST') {
      keys.push(JSON.parse(String(options.body)).idempotencyKey);
      if (keys.length === 1)
        return Response.json(
          { error: 'private provider details' },
          { status: 503 }
        );
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    }
    return Response.json({ draft: null, version: 0 });
  });
  render(<OxygenProviderFlow orderId={workflowId} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Continue NIN check' })
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'couldn’t continue'
  );
  expect(screen.queryByText(/private provider details/)).toBeNull();
  const retry = screen.getByRole('button', { name: 'Continue NIN check' });
  fireEvent.click(retry);
  fireEvent.click(retry);
  await waitFor(() => expect(keys).toEqual([key, key]));
  release(Response.json({ ...pending, version: 4, pending: null }));
});
