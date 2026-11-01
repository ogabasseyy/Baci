import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { reconcileOxygenActivation } from './activation-reconciliation';

it('reconciles only the current binding without any provider call', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: { orderConfirmed: true }, error: null });
  await expect(
    reconcileOxygenActivation({ rpc }, '1e65cf4b-4942-4ade-8149-e894687f6c40')
  ).resolves.toEqual({ orderConfirmed: true });
  expect(rpc).toHaveBeenCalledExactlyOnceWith('oxygen_reconcile_activation', {
    p_workflow_id: '1c0459fe-2d45-4d2c-b41a-0ac640ad9f89',
    p_reference: '1e65cf4b-4942-4ade-8149-e894687f6c40',
  });
});
it('denies unknown references before any database operation', async () => {
  const rpc = vi.fn();
  await expect(reconcileOxygenActivation({ rpc }, 'another')).rejects.toThrow();
  expect(rpc).not.toHaveBeenCalled();
});
it.each([
  { data: null, error: { code: '42501' } },
  { data: { orderConfirmed: false }, error: null },
])('does not assume reconciliation succeeded (%j)', async (response) => {
  const rpc = vi.fn().mockResolvedValue(response);
  await expect(
    reconcileOxygenActivation({ rpc }, '1e65cf4b-4942-4ade-8149-e894687f6c40')
  ).rejects.toThrow();
});
