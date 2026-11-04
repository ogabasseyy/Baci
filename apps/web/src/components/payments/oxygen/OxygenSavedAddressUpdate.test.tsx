import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: api.fetch }));
vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: vi.fn(),
}));

import { useOxygenProvider } from './use-oxygen-provider';

it('applies the callback-saved address completion without a loading flash or a provider command', async () => {
  const id = '60000000-0000-4000-8000-000000000001';
  let updated = false;
  let finish!: () => void;
  let hold = false;
  const snapshot = () => ({
    workflowId: id,
    version: updated ? 6 : 5,
    stage: updated ? 'approval_required' : 'booked',
    environment: 'staging',
    executionEnabled: true,
    approvalOtpReady: false,
    activationEnabled: false,
    settlementEnabled: false,
    state: {
      applicationReference: id,
      bookingReference: id,
      kyc: {
        bvn_status: 'DONE',
        nin_status: 'DONE',
        bank_status: 'DONE',
        phone_status: 'DONE',
        selfie_status: 'DONE',
        address_status: updated ? 'DONE' : 'PROCESSING',
      },
    },
  });
  api.fetch.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return Response.json({ workflow: { id } });
    if (hold)
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    return Response.json(snapshot());
  });
  const { result } = renderHook(() => useOxygenProvider(id));
  await waitFor(() => expect(result.current.snapshot?.stage).toBe('booked'));
  hold = true;
  let reading!: Promise<void>;
  act(() => {
    reading = result.current.readSaved();
  });
  expect(result.current.busy).toBe(false);
  updated = true;
  await act(async () => {
    finish();
    await reading;
  });
  expect(result.current.snapshot?.stage).toBe('approval_required');
  expect(result.current.snapshot?.state.kyc?.address_status).toBe('DONE');
  const posts = api.fetch.mock.calls.filter(
    ([, init]) => init?.method === 'POST'
  );
  expect(posts).toHaveLength(1); // Only the existing-workflow resume; no action POST.
  expect(
    api.fetch.mock.calls.filter(([url]) => String(url).includes('/actions'))
  ).toHaveLength(2);
});
