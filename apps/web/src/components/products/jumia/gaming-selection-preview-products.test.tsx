import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GamingSelectionPreviewProducts } from './gaming-selection-preview-products';

const snapshot = {
  selectionId: '00000000-0000-4000-8000-000000000025',
  total: 1,
  page: 1,
  totalPages: 2,
  legacyUnmappedCount: 0,
  products: [
    {
      id: 'item-1',
      available: true,
      unavailableReason: null,
      capturedSourceVersion: 'v1',
      currentSourceVersion: 'v1',
      product: { product: { name: 'Gamepad' } },
    },
  ],
};

describe('GamingSelectionPreviewProducts', () => {
  it('renders the page and moves forward through the supplied callback', () => {
    const onPageChange = vi.fn();
    render(
      <GamingSelectionPreviewProducts
        snapshot={snapshot}
        loading={false}
        onPageChange={onPageChange}
      />
    );

    expect(screen.getByText('Gamepad')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('disables pagination while a page request is loading', () => {
    render(
      <GamingSelectionPreviewProducts
        snapshot={snapshot}
        loading
        onPageChange={vi.fn()}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('Loading products');
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });
});
