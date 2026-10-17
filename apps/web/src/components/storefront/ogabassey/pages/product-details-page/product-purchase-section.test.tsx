import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ProductPurchasePanel } from './product-purchase-panel';
import { ProductDetailsPurchaseSection } from './product-purchase-section';

vi.mock('./product-interaction-panel', () => ({
  ProductInteractionPanel: (props: Record<string, unknown>) => (
    <div
      data-testid="interaction-panel"
      data-can-purchase={String(props.canPurchase)}
    />
  ),
}));

vi.mock('./product-purchase-panel', () => ({
  ProductPurchasePanel: (props: Record<string, unknown>) => (
    <div
      data-testid="purchase-panel"
      data-can-purchase={String(props.canPurchase)}
    />
  ),
}));

type PanelProps = ComponentProps<typeof ProductPurchasePanel>;

function props(
  overrides: Partial<PanelProps> & { isCommerceMode: boolean }
): PanelProps & { isCommerceMode: boolean } {
  return {
    canPurchase: true,
    ...overrides,
  } as PanelProps & { isCommerceMode: boolean };
}

describe('ProductDetailsPurchaseSection', () => {
  it('renders the interaction panel in commerce mode', () => {
    render(<ProductDetailsPurchaseSection {...props({ isCommerceMode: true })} />);

    expect(screen.getByTestId('interaction-panel')).toHaveAttribute(
      'data-can-purchase',
      'true'
    );
    expect(screen.queryByTestId('purchase-panel')).not.toBeInTheDocument();
  });

  it('renders the purchase panel in full mode', () => {
    render(
      <ProductDetailsPurchaseSection {...props({ isCommerceMode: false })} />
    );

    expect(screen.getByTestId('purchase-panel')).toHaveAttribute(
      'data-can-purchase',
      'true'
    );
    expect(screen.queryByTestId('interaction-panel')).not.toBeInTheDocument();
  });

  it('forwards panel props untouched', () => {
    render(
      <ProductDetailsPurchaseSection
        {...props({ canPurchase: false, isCommerceMode: false })}
      />
    );

    expect(screen.getByTestId('purchase-panel')).toHaveAttribute(
      'data-can-purchase',
      'false'
    );
  });
});
