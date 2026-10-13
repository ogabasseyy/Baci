import { describe, expect, it, vi } from 'vitest';
import {
  ACCESS_ROSTER_PAGE_SIZE,
  loadAccessMembers,
} from './access-roster-loader';

describe('loadAccessMembers', () => {
  it('loads a paginated access roster', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [],
          generatedAt: '2026-08-05T10:00:00.000Z',
          limit: ACCESS_ROSTER_PAGE_SIZE,
          offset: 0,
          truncated: false,
        }),
      })
    );

    await expect(
      loadAccessMembers(0, ACCESS_ROSTER_PAGE_SIZE)
    ).resolves.toEqual({
      data: [],
      generatedAt: '2026-08-05T10:00:00.000Z',
      limit: ACCESS_ROSTER_PAGE_SIZE,
      offset: 0,
      truncated: false,
    });

    vi.unstubAllGlobals();
  });
});
