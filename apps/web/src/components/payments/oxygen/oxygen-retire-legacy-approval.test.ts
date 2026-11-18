import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mocks.fetch }));

import { oxygenBookedSnapshot } from './oxygen-booked-snapshot.test-support';
import { retireLegacyQueuedApproval } from './oxygen-retire-legacy-approval';

it('requires a pending command and a confirmed retirement response', async () => {
  await expect(
    retireLegacyQueuedApproval(oxygenBookedSnapshot)
  ).rejects.toThrow();
  const snapshot = {
    ...oxygenBookedSnapshot,
    pending: {
      action: 'approve_booking',
      status: 'queued' as const,
      idempotencyKey: oxygenBookedSnapshot.workflowId,
    },
  };
  mocks.fetch.mockResolvedValueOnce(Response.json({ retired: false }));
  await expect(retireLegacyQueuedApproval(snapshot)).rejects.toThrow();
  mocks.fetch.mockResolvedValueOnce(Response.json({ retired: true }));
  await expect(retireLegacyQueuedApproval(snapshot)).resolves.toBeUndefined();
});
