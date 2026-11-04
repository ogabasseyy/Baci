import { beforeEach, expect, it, vi } from 'vitest';

const { fetchWithCsrf } = vi.hoisted(() => ({ fetchWithCsrf: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf }));

import {
  fetchOxygenSnapshot,
  initializeOxygenWorkflow,
} from './oxygen-workflow-initialization';

const id = '60000000-0000-4000-8000-000000000001';
beforeEach(() => {
  fetchWithCsrf.mockReset();
});

it('initializes an order-bound workflow with CSRF and no cache', async () => {
  const response = new Response();
  fetchWithCsrf.mockResolvedValue(response);
  const decode = vi.fn().mockResolvedValue({ workflow: { id } });
  await expect(initializeOxygenWorkflow('order-1', decode)).resolves.toBe(id);
  expect(fetchWithCsrf).toHaveBeenCalledWith('/api/payments/oxygen/workflows', {
    method: 'POST',
    body: JSON.stringify({ orderId: 'order-1', channel: 'web' }),
    cache: 'no-store',
  });
  expect(decode).toHaveBeenCalledWith(response);
});

it('rejects malformed workflow identifiers', async () => {
  fetchWithCsrf.mockResolvedValue(new Response());
  await expect(
    initializeOxygenWorkflow('order-1', async () => ({
      workflow: { id: 'invalid' },
    }))
  ).rejects.toThrow();
});

it('fetches and validates an uncached snapshot', async () => {
  fetchWithCsrf.mockResolvedValue(new Response());
  const snapshot = {
    workflowId: id,
    stage: 'application_required',
    version: 0,
    environment: 'staging',
    executionEnabled: false,
    state: {},
    approvalOtpReady: false,
    activationEnabled: false,
    settlementEnabled: false,
  };
  await expect(
    fetchOxygenSnapshot(id, async () => snapshot)
  ).resolves.toMatchObject(snapshot);
  expect(fetchWithCsrf).toHaveBeenCalledWith(
    `/api/payments/oxygen/workflows/actions?workflowId=${id}`,
    { cache: 'no-store' }
  );
  await expect(
    fetchOxygenSnapshot(id, async () => ({
      ...snapshot,
      state: { activityToken: 'secret' },
    }))
  ).rejects.toThrow();
});
