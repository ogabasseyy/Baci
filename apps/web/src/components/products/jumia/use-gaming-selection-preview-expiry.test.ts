import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithCsrf } from '@/lib/api-client';
import { useGamingSelectionPreview } from './use-gaming-selection-preview';

const { mockCategoryRange } = vi.hoisted(() => ({
  mockCategoryRange: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            ilike: () => ({
              order: () => ({ range: mockCategoryRange }),
            }),
          }),
        }),
      }),
    }),
  }),
}));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));

const selectionId = '00000000-0000-4000-8000-000000000026';

describe('Gaming preview creation expiry handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCategoryRange.mockReset();
    mockCategoryRange.mockResolvedValue({
      data: [{ id: 'canonical-gaming', name: 'Gaming' }],
      error: null,
    });
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    ['missing', {}],
    ['invalid', { expiresAt: 'not-a-date' }],
  ])('keeps the creation guard when the expiry is %s', async (_, expiry) => {
    vi.mocked(fetchWithCsrf).mockResolvedValue(
      Response.json({ selectionId, ...expiry }, { status: 201 })
    );
    const { result } = renderHook(() =>
      useGamingSelectionPreview('merchant-expiry')
    );

    await act(async () => result.current.createPreview('create'));

    expect(result.current.creationOutcomeUnknown).toBe(true);
    expect(result.current.error).toMatch(/may have created this preview/i);
  });

  it('does not use the browser clock to reject a server expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2100-01-01T00:00:00.000Z'));
    vi.mocked(fetchWithCsrf).mockResolvedValue(
      Response.json(
        { selectionId, expiresAt: '2099-01-01T00:00:00.000Z' },
        { status: 201 }
      )
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          selectionId,
          total: 0,
          page: 1,
          totalPages: 0,
          legacyUnmappedCount: 0,
          products: [],
        })
      )
    );
    const { result } = renderHook(() =>
      useGamingSelectionPreview('merchant-clock-ahead')
    );

    await act(async () => result.current.createPreview('create'));

    expect(result.current.snapshot?.selectionId).toBe(selectionId);
    expect(result.current.creationOutcomeUnknown).toBe(false);
  });
});
