import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));

import { fetchWithCsrf } from '@/lib/api-client';
import { deleteMediaFile } from './media-library-delete';

afterEach(() => vi.resetAllMocks());
describe('media deletion feedback', () => {
  it('explains referenced refusal', async () => {
    vi.mocked(fetchWithCsrf).mockResolvedValue(
      new Response(JSON.stringify({ code: 'media_in_use' }), { status: 409 })
    );
    await expect(deleteMediaFile('asset')).rejects.toMatchObject({
      pending: false,
      message: expect.stringContaining('still in use'),
    });
  });
  it('marks incomplete removals as retryable pending', async () => {
    vi.mocked(fetchWithCsrf).mockResolvedValue(
      new Response(JSON.stringify({ code: 'media_delete_pending' }), {
        status: 503,
      })
    );
    await expect(deleteMediaFile('asset')).rejects.toMatchObject({
      pending: true,
    });
  });
  it('requires a confirmed success body', async () => {
    vi.mocked(fetchWithCsrf).mockResolvedValue(new Response('{}'));
    await expect(deleteMediaFile('asset')).rejects.toThrow('Unable to delete');
  });
});
