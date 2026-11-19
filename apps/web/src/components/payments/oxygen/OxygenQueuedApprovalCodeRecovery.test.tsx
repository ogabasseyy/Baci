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

const id = '60000000-0000-4000-8000-000000000001';
const key = '70000000-0000-4000-8000-000000000001';
const base = oxygenRuntimeSnapshotSchema.parse({
  workflowId: id,
  stage: 'approval_required',
  version: 3,
  environment: 'staging',
  executionEnabled: true,
  state: {
    applicationReference: id,
    bookingReference: id,
    kyc: {
      address_status: 'DONE',
      bvn_status: 'DONE',
      nin_status: 'DONE',
      bank_status: 'DONE',
      phone_status: 'DONE',
      selfie_status: 'DONE',
    },
  },
  pending: {
    action: 'trigger_approval_otp',
    status: 'queued',
    idempotencyKey: key,
  },
  approvalOtpReady: false,
  activationEnabled: false,
  settlementEnabled: false,
});
it('only offers queued recovery when the booking is at the server-permitted approval stage', () => {
  expect(pendingReadRecovery(base)).toBe('trigger_approval_otp');
  expect(pendingReadRecovery({ ...base, executionEnabled: false })).toBeNull();
  expect(pendingReadRecovery({ ...base, stage: 'booked' })).toBeNull();
  expect(
    pendingReadRecovery({
      ...base,
      state: { ...base.state, bookingReference: undefined },
    })
  ).toBeNull();
  expect(
    pendingReadRecovery({
      ...base,
      state: {
        ...base.state,
        kyc: {
          address_status: 'PROCESSING',
          bvn_status: 'DONE',
          nin_status: 'DONE',
          bank_status: 'DONE',
          phone_status: 'DONE',
          selfie_status: 'DONE',
        },
      },
    })
  ).toBeNull();
});
it.each([
  'queued',
  'executing',
  'indeterminate',
] as const)('handles %s approval-code request without replaying an uncertain request', async (status) => {
  const snapshot = {
    ...base,
    pending: { action: 'trigger_approval_otp', status, idempotencyKey: key },
  };
  const commands: Array<{
    idempotencyKey: string;
    command: { action: string };
  }> = [];
  let release!: (value: Response) => void;
  fetcher.mockReset();
  fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/workflows')) return Response.json({ workflow: { id } });
    if (url.includes('/actions?')) return Response.json(snapshot);
    if (url.endsWith('/actions') && options?.method === 'POST') {
      commands.push(JSON.parse(String(options.body)));
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    }
    return Response.json({ draft: null, version: 0 });
  });
  render(<OxygenProviderFlow orderId={id} />);
  const button = await screen.findByRole('button', {
    name:
      status === 'queued'
        ? 'Continue sending approval code'
        : 'Check for an update',
  });
  expect(commands).toHaveLength(0);
  const before = fetcher.mock.calls.filter(([url]) =>
    String(url).includes('/actions?')
  ).length;
  fireEvent.click(button);
  fireEvent.click(button);
  if (status === 'queued') {
    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toMatchObject({
      idempotencyKey: key,
      command: { action: 'trigger_approval_otp' },
    });
    release(
      Response.json({
        ...snapshot,
        version: 4,
        pending: null,
        approvalOtpReady: true,
      })
    );
  } else {
    await waitFor(() =>
      expect(
        fetcher.mock.calls.filter(([url]) => String(url).includes('/actions?'))
          .length
      ).toBeGreaterThan(before)
    );
    expect(commands).toHaveLength(0);
  }
});
it('switches to status-only recovery when another worker claims the queued request', async () => {
  let snapshot = base;
  const posts: unknown[] = [];
  fetcher.mockReset();
  fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/workflows')) return Response.json({ workflow: { id } });
    if (url.includes('/actions?')) return Response.json(snapshot);
    if (url.endsWith('/actions') && options?.method === 'POST') {
      posts.push(JSON.parse(String(options.body)));
      snapshot = {
        ...base,
        pending: {
          action: 'trigger_approval_otp',
          status: 'executing',
          idempotencyKey: key,
        },
      };
      return Response.json(snapshot);
    }
    return Response.json({ draft: null, version: 0 });
  });
  render(<OxygenProviderFlow orderId={id} />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Continue sending approval code',
    })
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Check for an update' })
  );
  await waitFor(() =>
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).includes('/actions?'))
        .length
    ).toBeGreaterThan(1)
  );
  expect(posts).toEqual([
    expect.objectContaining({
      idempotencyKey: key,
      command: { action: 'trigger_approval_otp' },
    }),
  ]);
});
