import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createOxygenWorkflowWorkerStore } from './workflow-store';

const id = '8bb42a9f-9fb5-4ab4-a546-670e28f005f9';
it('uses parameterized claim and record calls and handles an already claimed command', async () => {
  const query = vi.fn().mockResolvedValue({ rows: [{ result: null }] });
  const store = createOxygenWorkflowWorkerStore({ query }, id);
  expect(await store.claim()).toBeNull();
  await store.record(id, 'indeterminate', 'reconciliation_required');
  expect(query.mock.calls).toEqual([
    ['select oxygen_private.claim_command($1::uuid) as result', [id]],
    [
      'select oxygen_private.record_command($1::uuid,$2::text,$3::text) as result',
      [id, 'indeterminate', 'reconciliation_required'],
    ],
  ]);
});
it('rejects secret-bearing or unrecognized stored commands', async () => {
  const query = vi.fn().mockResolvedValue({
    rows: [
      {
        result: {
          id,
          stage: 'booked',
          command: { action: 'approve', otp: 'secret' },
        },
      },
    ],
  });
  await expect(
    createOxygenWorkflowWorkerStore({ query }, id).claim()
  ).rejects.toThrow();
});
