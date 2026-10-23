import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithCsrf } from '@/lib/api-client';
import { GamingSelectionPreview } from './gaming-selection-preview';

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: mockFrom }),
}));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));

function setupCategory(name: string) {
  mockFrom.mockReturnValue({
    select: () => ({
      eq: () => ({
        eq: () => ({
          ilike: () => ({
            order: () => ({
              limit: async () => ({
                data: [{ id: 'gaming-category', name }],
                error: null,
              }),
            }),
          }),
        }),
      }),
    }),
  });
}

describe('GamingSelectionPreview category normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('accepts ordinary spaces like PostgreSQL btrim', async () => {
    setupCategory('  Gaming  ');
    vi.mocked(fetchWithCsrf).mockResolvedValue(
      Response.json(
        {
          selectionId: '00000000-0000-4000-8000-000000000013',
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
        { status: 201 }
      )
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          selectionId: '00000000-0000-4000-8000-000000000013',
          total: 0,
          page: 1,
          totalPages: 0,
          legacyUnmappedCount: 0,
          products: [],
        })
      )
    );
    render(<GamingSelectionPreview merchantId="merchant-1" />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Create Gaming preview' })
    );

    expect(
      await screen.findByText('No products in this Gaming selection.')
    ).toBeInTheDocument();
    expect(fetchWithCsrf).toHaveBeenCalledOnce();
  });

  it.each([
    '\tGaming\t',
    '\u00a0Gaming\u00a0',
  ])('does not treat non-space padding in %j as an active Gaming category', async (name) => {
    setupCategory(name);
    render(<GamingSelectionPreview merchantId="merchant-1" />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Create Gaming preview' })
    );

    expect(
      await screen.findByText(
        'An active Gaming category was not found for this store.'
      )
    ).toBeInTheDocument();
    expect(fetchWithCsrf).not.toHaveBeenCalled();
  });
});
