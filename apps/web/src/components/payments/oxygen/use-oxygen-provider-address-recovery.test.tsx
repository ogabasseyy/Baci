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

import { useOxygenProvider } from './use-oxygen-provider';

const workflowId = '60000000-0000-4000-8000-000000000001';
const reference = '70000000-0000-4000-8000-000000000001';
const key = '80000000-0000-4000-8000-000000000001';
const snapshot = {
  workflowId,
  stage: 'booked',
  version: 3,
  environment: 'staging',
  executionEnabled: true,
  approvalOtpReady: false,
  activationEnabled: false,
  settlementEnabled: false,
  state: {
    bookingReference: reference,
    booking: { status: 'BOOKED' },
    kyc: { address_status: 'NOT_DONE' },
  },
  pending: { action: 'submit_address', status: 'queued', idempotencyKey: key },
};
const command = {
  action: 'submit_address' as const,
  state: 'Lagos',
  lga: 'Ikeja',
  city: 'Ikeja',
  street: 'Road',
  landmark: 'Mall',
  house_number: '1',
};
const file = new File(
  [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
  'proof.png',
  { type: 'image/png' }
);
beforeEach(() => {
  vi.resetAllMocks();
  m.read.mockResolvedValue(snapshot);
});
it('retires queued work before sending selected proof with a fresh key', async () => {
  m.fetch
    .mockResolvedValueOnce(Response.json({ retired: true }))
    .mockResolvedValueOnce(
      Response.json({ ...snapshot, version: 4, pending: null })
    );
  const { result } = renderHook(() => useOxygenProvider(workflowId));
  await waitFor(() => expect(result.current.snapshot).toBeTruthy());
  await act(() => result.current.submit(command, file));
  expect(m.fetch.mock.calls[0][0]).toContain('/address-recovery');
  expect(JSON.parse(m.fetch.mock.calls[0][1].body)).toEqual({
    workflowId,
    version: 3,
    idempotencyKey: key,
    bookingReference: reference,
  });
  const body = m.fetch.mock.calls[1][1].body as FormData;
  expect(body.get('file')).toBe(file);
  expect(JSON.parse(String(body.get('payload'))).idempotencyKey).not.toBe(key);
});
it.each([
  'executing',
  'indeterminate',
])('never sends an %s command', async (status) => {
  m.read.mockResolvedValue({
    ...snapshot,
    pending: { ...snapshot.pending, status },
  });
  const { result } = renderHook(() => useOxygenProvider(workflowId));
  await waitFor(() => expect(result.current.snapshot).toBeTruthy());
  await act(() => result.current.submit(command, file));
  expect(m.fetch).not.toHaveBeenCalled();
});
it('does not dispatch after a lost retirement response', async () => {
  m.fetch.mockRejectedValueOnce(new Error('lost'));
  const { result } = renderHook(() => useOxygenProvider(workflowId));
  await waitFor(() => expect(result.current.snapshot).toBeTruthy());
  await act(() => result.current.submit(command, file));
  expect(m.fetch).toHaveBeenCalledTimes(1);
});

it('rejects invalid proof bytes or address fields before retiring', async () => {
  const { result } = renderHook(() => useOxygenProvider(workflowId));
  await waitFor(() => expect(result.current.snapshot).toBeTruthy());
  await act(() =>
    result.current.submit(
      command,
      new File(['fake'], 'proof.png', { type: 'image/png' })
    )
  );
  expect(m.fetch).not.toHaveBeenCalled();
  await act(() => result.current.submit({ ...command, street: '  ' }, file));
  expect(m.fetch).not.toHaveBeenCalled();
});
