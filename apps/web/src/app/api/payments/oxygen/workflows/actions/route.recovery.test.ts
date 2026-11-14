import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  read: vi.fn(),
  restore: vi.fn(),
  connect: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: m.auth }));
vi.mock('@/lib/payments/oxygen/runtime-service', () => ({
  readOxygenSnapshot: m.read,
  performOxygenAction: vi.fn(),
}));
vi.mock('@/lib/payments/oxygen/restore-eligibility-recovery', () => ({
  restoreOxygenEligibilityRecovery: m.restore,
}));
vi.mock('@/lib/payments/oxygen/runtime-connection', () => ({
  connectOxygenRuntime: m.connect,
}));

import { GET } from './route';

const id = '60000000-0000-4000-8000-000000000081';
const request = () =>
  new NextRequest(
    `http://localhost/api/payments/oxygen/workflows/actions?workflowId=${id}`
  );
beforeEach(() => vi.resetAllMocks());
it('does not construct a worker before authentication and ownership have succeeded', async () => {
  m.auth.mockResolvedValue({ error: 'unauthorized' });
  expect((await GET(request())).status).toBe(401);
  expect(m.read).not.toHaveBeenCalled();
  expect(m.connect).not.toHaveBeenCalled();
  m.auth.mockResolvedValue({ user: { id: 'customer' }, supabase: {} });
  m.read.mockRejectedValue(new Error('not owned'));
  expect((await GET(request())).status).toBe(404);
  expect(m.connect).not.toHaveBeenCalled();
  expect(m.restore).not.toHaveBeenCalled();
});
it('restores recovery only for the owned snapshot, without calling Oxygen', async () => {
  const client = {};
  const snapshot = {
    workflowId: id,
    executionEnabled: true,
    state: { validated: true },
  };
  const worker = vi.fn();
  const call = vi.fn();
  m.auth.mockResolvedValue({ user: { id: 'customer' }, supabase: client });
  m.read.mockResolvedValue(snapshot);
  m.connect.mockReturnValue({ worker, provider: { call } });
  m.restore.mockResolvedValue({
    ...snapshot,
    state: { ...snapshot.state, eligibilityStatus: 'failed' },
  });
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(m.read).toHaveBeenCalledExactlyOnceWith(client, id);
  expect(m.restore).toHaveBeenCalledExactlyOnceWith(snapshot, worker);
  expect((await response.json()).state.eligibilityStatus).toBe('failed');
  expect(call).not.toHaveBeenCalled();
});
