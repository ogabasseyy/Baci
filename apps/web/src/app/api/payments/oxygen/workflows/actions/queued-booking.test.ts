import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: m.auth }));
vi.mock('@/lib/payments/oxygen/runtime-service', () => ({
  readOxygenSnapshot: m.read,
  performOxygenAction: vi.fn(),
}));
vi.mock('@/lib/payments/oxygen/runtime-connection', () => ({
  connectOxygenRuntime: () => null,
}));
vi.mock('@/lib/payments/oxygen/nin-retry-status', () => ({
  readOxygenNinRetryStatus: async () => 'blocked',
}));

import { GET } from './route';

const workflowId = '60000000-0000-4000-8000-000000000001';
const key = '70000000-0000-4000-8000-000000000001';
const snapshot = {
  workflowId,
  version: 3,
  stage: 'plan_required',
  environment: 'staging',
  executionEnabled: true,
  state: {},
  pending: { action: 'book', status: 'queued', idempotencyKey: key },
  approvalOtpReady: false,
  activationEnabled: false,
  settlementEnabled: false,
};
const request = () =>
  new NextRequest(
    `http://localhost/api/payments/oxygen/workflows/actions?workflowId=${workflowId}`
  );
beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({
    user: { id: workflowId },
    supabase: { rpc: m.rpc },
  });
  m.read.mockResolvedValue(snapshot);
});
it('adds only validated terms from the owned queued command', async () => {
  m.rpc.mockResolvedValue({
    data: { equityPercentage: 35, tenure: 6 },
    error: null,
  });
  const result = await GET(request());
  expect(result.status).toBe(200);
  expect(m.rpc).toHaveBeenCalledWith('oxygen_queued_booking_terms', {
    p_workflow_id: workflowId,
    p_version: 3,
    p_key: key,
  });
  expect((await result.json()).pending.bookingTerms).toEqual({
    equityPercentage: 35,
    tenure: 6,
  });
});
it.each([
  'executing',
  'indeterminate',
])('never reads terms for a %s booking', async (status) => {
  m.read.mockResolvedValue({
    ...snapshot,
    pending: { ...snapshot.pending, status },
  });
  expect((await GET(request())).status).toBe(200);
  expect(m.rpc).not.toHaveBeenCalled();
});
it('fails closed on malformed stored terms', async () => {
  m.rpc.mockResolvedValue({
    data: { equityPercentage: 35, tenure: 99 },
    error: null,
  });
  expect((await GET(request())).status).toBe(404);
});
it('returns no recovery terms when the command was claimed after the snapshot', async () => {
  m.rpc.mockResolvedValue({ data: null, error: null });
  const result = await GET(request());
  expect(result.status).toBe(200);
  expect((await result.json()).pending).toEqual(snapshot.pending);
});
it('fails closed when the terms RPC fails', async () => {
  m.rpc.mockResolvedValue({
    data: null,
    error: { message: 'private database error' },
  });
  const result = await GET(request());
  expect(result.status).toBe(404);
  expect(await result.json()).toEqual({ error: 'Workflow unavailable' });
});
