import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { readOxygenErrorReport } from './error-report';

const id = '60000000-0000-4000-8000-000000000001';
it('retrieves only this workflow through the scoped worker RPC without provider calls', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
  await expect(readOxygenErrorReport({ rpc }, id)).resolves.toEqual([]);
  expect(rpc).toHaveBeenCalledExactlyOnceWith('oxygen_error_report', {
    p_workflow_id: id,
  });
});
it('does not disclose private database errors or accept raw report fields', async () => {
  await expect(
    readOxygenErrorReport(
      { rpc: async () => ({ data: null, error: { code: 'secret' } }) },
      id
    )
  ).rejects.toThrow('Error report unavailable for this worker');
  await expect(
    readOxygenErrorReport(
      { rpc: async () => ({ data: [{ rawBody: 'private' }], error: null }) },
      id
    )
  ).rejects.toThrow();
});
