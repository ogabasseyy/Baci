import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMatchingGamingCategories } from './fetch-matching-gaming-categories';

const { mockRange } = vi.hoisted(() => ({ mockRange: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            ilike: () => ({
              order: () => ({ range: mockRange }),
            }),
          }),
        }),
      }),
    }),
  }),
}));

describe('fetchMatchingGamingCategories', () => {
  beforeEach(() => mockRange.mockReset());

  it('collects matching categories across pages until a short page', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({
      id: `category-${index}`,
      name: 'Gaming accessories',
    }));
    const secondPage = [{ id: 'gaming-category', name: 'Gaming' }];
    mockRange
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({ data: secondPage, error: null });

    await expect(fetchMatchingGamingCategories('merchant-1')).resolves.toEqual({
      data: [...firstPage, ...secondPage],
      error: null,
    });
    expect(mockRange.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('returns the database error and stops pagination', async () => {
    const databaseError = { message: 'query failed' };
    mockRange
      .mockResolvedValueOnce({
        data: Array.from({ length: 1000 }, (_, index) => ({
          id: `category-${index}`,
          name: 'Gaming accessories',
        })),
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: databaseError });

    await expect(fetchMatchingGamingCategories('merchant-1')).resolves.toEqual({
      data: null,
      error: databaseError,
    });
    expect(mockRange).toHaveBeenCalledTimes(2);
  });
});
