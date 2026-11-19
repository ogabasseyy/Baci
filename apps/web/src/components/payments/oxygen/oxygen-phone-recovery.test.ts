import { beforeEach, expect, it, vi } from 'vitest';

const fetcher = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: fetcher }));

import { retireQueuedPhoneVerification } from './oxygen-phone-recovery';

beforeEach(() => vi.resetAllMocks());
it('submits the exact workflow, version, and durable key', async () => {
  fetcher.mockResolvedValue(Response.json({ retired: true }));
  await retireQueuedPhoneVerification('workflow', 2, 'key');
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    '/api/payments/oxygen/workflows/phone-recovery',
    {
      method: 'POST',
      cache: 'no-store',
      body: JSON.stringify({
        workflowId: 'workflow',
        version: 2,
        idempotencyKey: 'key',
      }),
    }
  );
});
it.each([
  Response.json({ retired: false }),
  Response.json({ retired: true }, { status: 409 }),
])('fails closed unless retirement is confirmed', async (response) => {
  fetcher.mockResolvedValue(response);
  await expect(
    retireQueuedPhoneVerification('workflow', 2, 'key')
  ).rejects.toThrow('Unable to continue');
});
