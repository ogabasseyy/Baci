import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithCsrf } from '@/lib/api-client';
import { GamingSelectionPreview } from './gaming-selection-preview';

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            ilike: () => ({
              order: () => ({
                limit: async () => ({
                  data: [{ id: 'gaming-category', name: 'Gaming' }],
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  }),
}));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));

describe('GamingSelectionPreview unmount recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('preserves the explicit retry requirement after the preview unmounts', async () => {
    vi.mocked(fetchWithCsrf)
      .mockResolvedValueOnce(new Response('truncated', { status: 201 }))
      .mockResolvedValueOnce(
        Response.json(
          {
            selectionId: '00000000-0000-4000-8000-000000000024',
            expiresAt: '2099-01-01T00:00:00.000Z',
          },
          { status: 201 }
        )
      );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          selectionId: '00000000-0000-4000-8000-000000000024',
          total: 0,
          page: 1,
          totalPages: 0,
          legacyUnmappedCount: 0,
          products: [],
        })
      )
    );

    const firstRender = render(
      <GamingSelectionPreview merchantId="merchant-1" />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Create Gaming preview' })
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The server may have created this preview'
    );
    firstRender.unmount();

    render(<GamingSelectionPreview merchantId="merchant-1" />);
    const retryButton = await screen.findByRole('button', {
      name: 'Retry preview creation',
    });
    expect(fetchWithCsrf).toHaveBeenCalledOnce();

    fireEvent.click(retryButton);
    expect(
      await screen.findByText('No products in this Gaming selection.')
    ).toBeInTheDocument();
    expect(fetchWithCsrf).toHaveBeenCalledTimes(2);
  });
});
