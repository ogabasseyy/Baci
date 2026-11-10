import { expect, it } from 'vitest';
import { id, setup } from './edit-service.test-support';
import { previewStorefront } from './preview';
import { queueStorefrontEdit } from './queue-edit';

it('full-code and unknown modes reject legacy enqueue before creating an AI job', async () => {
  for (const mode of ['full-code', null]) {
    const { ctx, rpc } = setup(null);
    rpc.mockImplementation(async (name: string) => {
      if (name === 'builder_queue_edit') throw Error('QUEUE_MUST_NOT_RUN');
      return { data: mode, error: null };
    });
    await expect(
      queueStorefrontEdit(ctx, {
        storefrontId: id,
        expectedVersion: `draft:${id}`,
        idempotencyKey: id,
        pageSlug: 'home',
        instructions: 'Edit',
      })
    ).rejects.toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_TEMPLATE' })
    );
    expect(rpc.mock.calls.some(([name]) => name === 'builder_queue_edit')).toBe(
      false
    );
  }
});

it('full-code metadata rejects legacy preview before reading catalog', async () => {
  const { ctx, rpc } = setup(null);
  rpc.mockResolvedValue({ data: 'full-code', error: null });
  await expect(
    previewStorefront(ctx, {
      storefrontId: id,
      expectedVersion: `draft:${id}`,
      pageSlug: 'home',
    })
  ).rejects.toThrow(expect.objectContaining({ code: 'UNSUPPORTED_TEMPLATE' }));
  expect(rpc).toHaveBeenCalledOnce();
});
