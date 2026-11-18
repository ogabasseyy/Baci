import { expect, it, vi } from 'vitest';
import { admitLegacyExecution } from './legacy-execution';

const id = '11111111-1111-4111-8111-111111111111';
it('requires server admission and retains an unacknowledged lease when cleanup fails', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ data: id, error: null })
    .mockResolvedValueOnce({ data: null, error: { message: 'failure' } })
    .mockResolvedValue({ data: true, error: null });
  const close = await admitLegacyExecution({ rpc } as never, id);
  await expect(close()).rejects.toThrow('LEGACY_ACKNOWLEDGEMENT_REQUIRED');
  await close();
  await close();
  expect(rpc).toHaveBeenCalledTimes(3);
  expect(rpc).toHaveBeenLastCalledWith('experience_complete_legacy_execution', {
    p_merchant: id,
    p_lease: id,
  });
});
it('fails closed on full-code, unknown mode or malformed lease authority', async () => {
  for (const result of [
    { data: null, error: { message: 'FULL_CODE_ACTIVE' } },
    { data: 'legacy', error: null },
  ]) {
    const rpc = vi.fn().mockResolvedValue(result);
    await expect(admitLegacyExecution({ rpc } as never, id)).rejects.toThrow(
      'LEGACY_EXECUTION_DENIED'
    );
    expect(rpc).toHaveBeenCalledOnce();
  }
});
