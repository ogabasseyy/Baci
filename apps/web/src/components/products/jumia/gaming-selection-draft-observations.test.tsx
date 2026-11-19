import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JumiaProductExportEligiblePage } from '@/schemas/jumia/eligible-page';
import { GamingSelectionPreview } from './gaming-selection-preview';

const id = '00000000-0000-4000-8000-000000000001';
const selectionId = '00000000-0000-4000-8000-000000000020';
function page(number = 1): JumiaProductExportEligiblePage {
  return {
    selectionId,
    sourceCategoryId: '00000000-0000-4000-8000-000000000010',
    page: number,
    limit: 1,
    total: 2,
    totalPages: 2,
    legacyUnmappedCount: 0,
    products: [
      {
        id: number === 1 ? id : '00000000-0000-4000-8000-000000000002',
        ordinal: number,
        available: true,
        unavailableReason: null,
        capturedSourceVersion: 'a'.repeat(64),
        currentSourceVersion: 'a'.repeat(64),
        product: { product: { name: number === 1 ? 'Gamepad' : 'Console' } },
      },
    ],
  };
}
let snapshot = page();
vi.mock('./use-gaming-selection-preview', () => ({
  useGamingSelectionPreview: () => ({
    snapshot,
    loading: false,
    error: null,
    creationOutcomeUnknown: false,
    createPreview: vi.fn(),
    goToPage: vi.fn(),
  }),
}));

describe('Gaming draft fresh observations fence cached controls', () => {
  beforeEach(() => {
    snapshot = page();
  });

  it.each([
    ['unavailable', false],
    ['changed', false],
    ['unavailable', true],
    ['changed', true],
  ])('blocks never-selected %s rows even when a later page fails: %s', async (state, failLater) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const number = Number(
          new URL(url, 'http://localhost').searchParams.get('page')
        );
        if (number === 2)
          return failLater
            ? Response.json({}, { status: 500 })
            : Response.json(page(2));
        return Response.json({
          ...page(),
          products: [
            {
              ...page().products[0],
              available: state !== 'unavailable',
              currentSourceVersion: state === 'changed' ? 'b'.repeat(64) : null,
            },
          ],
        });
      })
    );
    const view = render(<GamingSelectionPreview merchantId="merchant-1" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Select all eligible' })
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Select all eligible' })
      ).toBeEnabled()
    );
    expect(
      screen.getByRole('checkbox', { name: 'Select Gamepad for draft' })
    ).toBeDisabled();
    expect(
      screen.getByText(/Observed source change or unavailability/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(`${failLater ? 0 : 1} selected in draft`)
    ).toBeInTheDocument();
    if (!failLater)
      fireEvent.click(
        screen.getByRole('button', { name: 'Clear draft selection' })
      );
    expect(
      screen.getByRole('checkbox', { name: 'Select Gamepad for draft' })
    ).toBeDisabled();
    snapshot = {
      ...page(),
      selectionId: '00000000-0000-4000-8000-000000000021',
    };
    view.rerender(<GamingSelectionPreview merchantId="merchant-1" />);
    expect(
      screen.getByRole('checkbox', { name: 'Select Gamepad for draft' })
    ).toBeEnabled();
    expect(screen.getByText('0 selected in draft')).toBeInTheDocument();
  });

  it('allows deselection but not reselecting a freshly invalid product from cached details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const number = Number(
          new URL(url, 'http://localhost').searchParams.get('page')
        );
        return Response.json(
          number === 1
            ? {
                ...page(),
                products: [
                  {
                    ...page().products[0],
                    currentSourceVersion: 'b'.repeat(64),
                  },
                ],
              }
            : page(2)
        );
      })
    );
    render(<GamingSelectionPreview merchantId="merchant-1" />);
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Select Gamepad for draft' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Select all eligible' })
    );
    await screen.findByRole('alert');
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Select all eligible' })
      ).toBeEnabled()
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Select Gamepad for draft' })
    );
    expect(
      screen.getByRole('checkbox', { name: 'Select Gamepad for draft' })
    ).toBeDisabled();
    expect(screen.getByText('1 selected in draft')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
