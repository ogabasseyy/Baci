import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ fetch: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: m.fetch }));
vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: vi.fn(),
}));
vi.mock('./oxygen-workflow-initialization', () => ({
  initializeOxygenWorkflow: vi
    .fn()
    .mockResolvedValue('60000000-0000-4000-8000-000000000001'),
  fetchOxygenSnapshot: m.read,
}));

import { oxygenBookedSnapshot } from './oxygen-booked-snapshot.test-support';
import { useOxygenProvider } from './use-oxygen-provider';

const key = '80000000-0000-4000-8000-000000000001';
const snapshot = {
  ...oxygenBookedSnapshot,
  stage: 'approval_required' as const,
  state: {
    ...oxygenBookedSnapshot.state,
    applicationReference: oxygenBookedSnapshot.workflowId,
    validated: true,
    kyc: {
      phone_status: 'DONE',
      bvn_status: 'DONE',
      selfie_status: 'DONE',
      nin_status: 'DONE',
      bank_status: 'DONE',
      address_status: 'DONE',
    },
  },
  pending: {
    action: 'approve_booking',
    status: 'queued' as const,
    idempotencyKey: key,
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  m.read.mockResolvedValue(snapshot);
});

it('retires only the queued approval before sending a new eligibility read', async () => {
  m.fetch
    .mockResolvedValueOnce(Response.json({ retired: true }))
    .mockResolvedValueOnce(Response.json({ ...snapshot, pending: null }));
  const { result } = renderHook(() => useOxygenProvider(snapshot.workflowId));
  await waitFor(() => expect(result.current.snapshot).toBeTruthy());
  await act(() => result.current.submit({ action: 'refresh_eligibility' }));
  expect(m.fetch.mock.calls[0][0]).toContain('/legacy-approval-recovery');
  expect(JSON.parse(String(m.fetch.mock.calls[0][1].body)).idempotencyKey).toBe(
    key
  );
  const payload = JSON.parse(String(m.fetch.mock.calls[1][1].body));
  expect(payload.command).toEqual({ action: 'refresh_eligibility' });
  expect(payload.idempotencyKey).not.toBe(key);
});

it('does not send a new eligibility read if retirement is unconfirmed', async () => {
  m.fetch.mockResolvedValueOnce(
    Response.json({ error: 'conflict' }, { status: 409 })
  );
  const { result } = renderHook(() => useOxygenProvider(snapshot.workflowId));
  await waitFor(() => expect(result.current.snapshot).toBeTruthy());
  await act(() => result.current.submit({ action: 'refresh_eligibility' }));
  expect(m.fetch).toHaveBeenCalledTimes(1);
});

it('retires a queued legacy booking before refreshing offers', async () => {
  const booking = {
    ...snapshot,
    stage: 'plan_required' as const,
    state: {
      ...snapshot.state,
      booking: undefined,
      bookingReference: undefined,
    },
    pending: { ...snapshot.pending, action: 'book' },
  };
  m.read.mockResolvedValue(booking);
  m.fetch
    .mockResolvedValueOnce(Response.json({ retired: true }))
    .mockResolvedValueOnce(
      Response.json({ ...booking, version: booking.version + 1, pending: null })
    );
  const { result } = renderHook(() => useOxygenProvider(snapshot.workflowId));
  await waitFor(() => expect(result.current.snapshot).toBeTruthy());
  let completed = false;
  await act(async () => {
    completed = await result.current.submit({ action: 'refresh_eligibility' });
  });
  expect(completed).toBe(true);
  expect(m.fetch.mock.calls[0][0]).toContain('/legacy-approval-recovery');
  expect(JSON.parse(String(m.fetch.mock.calls[1][1].body)).command).toEqual({
    action: 'refresh_eligibility',
  });
});

it.each([
  'executing',
  'indeterminate',
] as const)('never retires an %s approval', async (status) => {
  m.read.mockResolvedValue({
    ...snapshot,
    pending: { ...snapshot.pending, status },
  });
  const { result } = renderHook(() => useOxygenProvider(snapshot.workflowId));
  await waitFor(() => expect(result.current.snapshot).toBeTruthy());
  await act(() => result.current.submit({ action: 'refresh_eligibility' }));
  expect(m.fetch).not.toHaveBeenCalled();
});
