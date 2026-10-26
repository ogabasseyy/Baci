import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { mutatePrivateBrowserDraft } from './browser-private-drafts';

const id = '10000000-0000-4000-8000-000000000001';
const config = { root: { title: 'Home' }, content: [], zones: {} };
describe('browser private adapter', () => {
  it('preserves save receipt and never queries public draft columns', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { id, updated_at: '2026-10-22T10:00:00Z' },
      error: null,
    });
    const client = {
      rpc,
      from: () => {
        throw new Error('Public draft access');
      },
    } as unknown as SupabaseClient;
    expect(
      await mutatePrivateBrowserDraft(client, id, {
        slug: 'home',
        name: 'Home',
        config,
        expectedLastUpdated: null,
      })
    ).toEqual({
      data: { id, updated_at: '2026-10-22T10:00:00Z' },
      lastUpdated: '2026-10-22T10:00:00Z',
    });
    expect(rpc).toHaveBeenCalledWith(
      'builder_private_save',
      expect.objectContaining({
        p_expected: null,
        p_config: config,
        p_seo: null,
      })
    );
  });
  it('surfaces lock contention and stale CAS as the existing 409 contract', async () => {
    for (const response of [
      { data: null, error: { code: '40001' } },
      { data: { code: 'stale_builder_draft' }, error: null },
    ]) {
      const client = {
        rpc: vi.fn().mockResolvedValue(response),
      } as unknown as SupabaseClient;
      const result = await mutatePrivateBrowserDraft(client, id, {
        slug: 'home',
        expectedLastUpdated: null,
      });
      expect(result.response?.status).toBe(409);
      expect(await result.response?.json()).toMatchObject({
        code: 'stale_builder_draft',
      });
    }
  });
  it('reads a CAS token only for the historical omitted-token DTO', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: { updated_at: 'stamp' }, error: null })
      .mockResolvedValueOnce({
        data: { id, updated_at: 'new-stamp' },
        error: null,
      });
    await mutatePrivateBrowserDraft({ rpc } as unknown as SupabaseClient, id, {
      slug: 'home',
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'builder_private_publish', {
      p_merchant_id: id,
      p_slug: 'home',
      p_expected: 'stamp',
      p_scope: 'browser',
    });
  });
  it('does not expose SQL details', async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'XX001', message: 'sensitive data' },
      }),
    } as unknown as SupabaseClient;
    const result = await mutatePrivateBrowserDraft(client, id, {
      slug: 'home',
      expectedLastUpdated: null,
    });
    expect(JSON.stringify(await result.response?.json())).not.toContain(
      'sensitive'
    );
    expect(result.response?.status).toBe(500);
  });
});
