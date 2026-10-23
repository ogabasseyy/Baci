import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithCsrf } from '@/lib/api-client';
import {
  createGamingSelection,
  UnreadableSelectionCreationError,
} from './selection-create-request';

vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));

describe('Gaming selection create request', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a validated selection response', async () => {
    vi.mocked(fetchWithCsrf).mockResolvedValueOnce(
      Response.json({
        selectionId: '00000000-0000-4000-8000-000000000041',
        expiresAt: '2026-10-24T00:00:00.000Z',
      })
    );

    await expect(
      createGamingSelection('merchant-1', 'category-1')
    ).resolves.toEqual({
      selectionId: '00000000-0000-4000-8000-000000000041',
      expiresAt: '2026-10-24T00:00:00.000Z',
    });
  });

  it('classifies transport and unreadable successful responses as uncertain', async () => {
    vi.mocked(fetchWithCsrf)
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );

    await expect(
      createGamingSelection('merchant-1', 'category-1')
    ).rejects.toBeInstanceOf(UnreadableSelectionCreationError);
    await expect(
      createGamingSelection('merchant-1', 'category-1')
    ).rejects.toBeInstanceOf(UnreadableSelectionCreationError);
  });
});
