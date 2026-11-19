import { expect, it, vi } from 'vitest';
import { confirmDraftApply } from './approval-service';

const id = '11111111-1111-4111-8111-111111111111';
it('reconciles the committed receipt without a stale preflight load or second confirmation', async () => {
  const rpc = vi.fn(async (name: string) => {
    if (name === 'experience_load_draft_approval') throw Error('STALE_DRAFT');
    return { data: { buildId: id, version: 1 }, error: null };
  });
  const client = {
    auth: { getUser: async () => ({ data: { user: { id } }, error: null }) },
    rpc,
  };
  await expect(confirmDraftApply(client as never, id)).resolves.toEqual({
    buildId: id,
    version: 1,
  });
  expect(rpc).toHaveBeenCalledOnce();
  expect(rpc).toHaveBeenCalledWith('experience_confirm_draft_apply', {
    p_intent: id,
  });
});
it('requires owner authentication and returns no fabricated receipt on failure', async () => {
  const rpc = vi.fn(async () => ({
    data: null,
    error: { message: 'private detail' },
  }));
  const client = {
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    rpc,
  };
  await expect(confirmDraftApply(client as never, id)).rejects.toThrow(
    'NOT_FOUND'
  );
  expect(rpc).not.toHaveBeenCalled();
});
