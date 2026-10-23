import { expect, it } from 'vitest';
import { setup } from './edit-service.test-support';
import { loadPreviewData } from './preview-data';

it('rejects an unsupported bound snapshot before catalog access', async () => {
  const { ctx } = setup(null);
  await expect(
    loadPreviewData(ctx, { content: [] }, 'draft:invalid')
  ).rejects.toThrow(expect.objectContaining({ code: 'UNSUPPORTED_TEMPLATE' }));
});
it('requires read scope before projecting any snapshot', async () => {
  const { ctx } = setup(null);
  ctx.identity = { ...ctx.identity, scopes: new Set() };
  await expect(loadPreviewData(ctx, {}, 'draft:invalid')).rejects.toThrow(
    expect.objectContaining({ code: 'INSUFFICIENT_SCOPE' })
  );
});
