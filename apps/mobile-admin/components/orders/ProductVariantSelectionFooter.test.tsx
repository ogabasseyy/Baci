import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AdminProductVariant } from '@/lib/product-picker-variant-rows';
import { ProductVariantSelectionFooter } from './ProductVariantSelectionFooter';

const colors = {
  primary: '#2563eb',
  text: '#0f172a',
  textMuted: '#64748b',
  textOnPrimary: '#ffffff',
};

describe('ProductVariantSelectionFooter', () => {
  it('keeps the action disabled until an exact variant is selected', () => {
    const onAdd = vi.fn();
    const { rerender } = render(
      <ProductVariantSelectionFooter
        colors={colors}
        onAdd={onAdd}
        selectedVariant={null}
      />
    );

    expect(
      screen.getByRole('button', { name: 'Add selected variant' })
    ).toBeDisabled();

    rerender(
      <ProductVariantSelectionFooter
        colors={colors}
        onAdd={onAdd}
        selectedVariant={
          { id: 'variant-1', name: '64GB / New' } as AdminProductVariant
        }
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Add selected variant' })
    );

    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
