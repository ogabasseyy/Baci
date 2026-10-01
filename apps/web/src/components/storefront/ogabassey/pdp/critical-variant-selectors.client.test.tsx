import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OgabasseyPdpCriticalVariantSelectors } from './critical-variant-selectors.client';

const variants = [
  {
    attributes: { color: 'Graphite', ram: '4GB', storage: '128GB' },
    id: 'variant-128-4',
    merchant_id: 'merchant-1',
    product_id: 'product-1',
    stock_quantity: 10,
  },
  {
    attributes: { color: 'Graphite', ram: '8GB', storage: '256GB' },
    id: 'variant-256-8',
    merchant_id: 'merchant-1',
    product_id: 'product-1',
    stock_quantity: 8,
  },
];

describe('OgabasseyPdpCriticalVariantSelectors', () => {
  it('renders selectable variant axes and reports option clicks', () => {
    const onAttributeSelection = vi.fn();

    render(
      <OgabasseyPdpCriticalVariantSelectors
        onAttributeSelection={onAttributeSelection}
        renderableVariantAxes={['storage', 'ram']}
        selectedAttributes={{ ram: '4GB', storage: '128GB' }}
        variantCount={2}
        variants={variants}
      />
    );

    expect(
      screen.getByText('Choose options below before checkout.')
    ).toBeInTheDocument();
    expect(screen.getByText('Storage:')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /select 128gb storage/i })
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('button', { name: /select 256gb storage/i })
    ).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(
      screen.getByRole('button', { name: /select 256gb storage/i })
    );

    expect(onAttributeSelection).toHaveBeenCalledWith('storage', '256GB');
  });

  it('shows placeholder text when an axis is not selected', () => {
    render(
      <OgabasseyPdpCriticalVariantSelectors
        onAttributeSelection={vi.fn()}
        renderableVariantAxes={['storage', 'ram']}
        selectedAttributes={{}}
        variantCount={2}
        variants={variants}
      />
    );

    expect(screen.getByText('Select storage')).toBeInTheDocument();
    expect(screen.getByText('Select ram')).toBeInTheDocument();
  });

  it('renders multiple selected axes', () => {
    render(
      <OgabasseyPdpCriticalVariantSelectors
        onAttributeSelection={vi.fn()}
        renderableVariantAxes={['storage', 'ram']}
        selectedAttributes={{ ram: '8GB', storage: '256GB' }}
        variantCount={2}
        variants={variants}
      />
    );

    expect(screen.getByText('256GB', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('8GB', { selector: 'strong' })).toBeInTheDocument();
  });

  it('renders a single-option axis as already selected', () => {
    render(
      <OgabasseyPdpCriticalVariantSelectors
        onAttributeSelection={vi.fn()}
        renderableVariantAxes={['storage']}
        selectedAttributes={{ storage: '128GB' }}
        variantCount={2}
        variants={[
          {
            attributes: { color: 'Black', storage: '128GB' },
            id: 'variant-black',
            merchant_id: 'merchant-1',
            product_id: 'product-1',
            stock_quantity: 2,
          },
          {
            attributes: { color: 'Blue', storage: '128GB' },
            id: 'variant-blue',
            merchant_id: 'merchant-1',
            product_id: 'product-1',
            stock_quantity: 2,
          },
        ]}
      />
    );

    expect(screen.getByText('128GB', { selector: 'strong' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /select 128gb storage/i })
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders a selected single-option axis for a single SKU', () => {
    render(
      <OgabasseyPdpCriticalVariantSelectors
        onAttributeSelection={vi.fn()}
        renderableVariantAxes={['storage']}
        selectedAttributes={{ storage: '512GB' }}
        variantCount={1}
        variants={[
          {
            attributes: { storage: '512GB' },
            id: 'variant-512',
            merchant_id: 'merchant-1',
            product_id: 'product-1',
            stock_quantity: 2,
          },
        ]}
      />
    );

    expect(
      screen.queryByText('Choose options below before checkout.')
    ).toBeNull();
    expect(screen.getByText('512GB', { selector: 'strong' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /select 512gb storage/i })
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders multi-condition options from top-level variant conditions', () => {
    const onAttributeSelection = vi.fn();

    render(
      <OgabasseyPdpCriticalVariantSelectors
        onAttributeSelection={onAttributeSelection}
        renderableVariantAxes={['condition']}
        selectedAttributes={{ condition: 'used' }}
        variantCount={2}
        variants={[
          {
            attributes: { storage: '128GB' },
            condition: 'uk_used' as never,
            id: 'variant-used',
            merchant_id: 'merchant-1',
            product_id: 'product-1',
            stock_quantity: 2,
          },
          {
            attributes: { storage: '128GB' },
            condition: 'refurbished',
            id: 'variant-open-box',
            merchant_id: 'merchant-1',
            product_id: 'product-1',
            stock_quantity: 2,
          },
        ]}
      />
    );

    expect(screen.getByText('Condition:')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /select used condition/i })
    ).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(
      screen.getByRole('button', { name: /select open box condition/i })
    );

    expect(onAttributeSelection).toHaveBeenCalledWith('condition', 'open_box');
  });

  it('lets users switch to another real SKU option so conflicts can be pruned', () => {
    const onAttributeSelection = vi.fn();
    render(
      <OgabasseyPdpCriticalVariantSelectors
        onAttributeSelection={onAttributeSelection}
        renderableVariantAxes={['storage', 'ram']}
        selectedAttributes={{ storage: '256GB' }}
        variantCount={2}
        variants={variants}
      />
    );

    const alternative = screen.getByRole('button', {
      name: /select 4gb ram/i,
    });
    expect(alternative).toBeEnabled();

    fireEvent.click(alternative);
    expect(onAttributeSelection).toHaveBeenCalledWith('ram', '4GB');
  });

  it('renders options for legacy-cased variant attribute keys', () => {
    render(
      <OgabasseyPdpCriticalVariantSelectors
        onAttributeSelection={vi.fn()}
        renderableVariantAxes={['storage']}
        selectedAttributes={{ storage: '128GB' }}
        variantCount={2}
        variants={[
          {
            attributes: { Storage: '128GB' },
            id: 'variant-128',
            merchant_id: 'merchant-1',
            product_id: 'product-1',
            stock_quantity: 2,
          },
          {
            attributes: { Storage: '256GB' },
            id: 'variant-256',
            merchant_id: 'merchant-1',
            product_id: 'product-1',
            stock_quantity: 2,
          },
        ]}
      />
    );

    expect(
      screen.getByRole('button', { name: /select 128gb storage/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /select 256gb storage/i })
    ).toBeInTheDocument();
  });

  it('ignores malformed variant attribute values while rendering options', () => {
    render(
      <OgabasseyPdpCriticalVariantSelectors
        onAttributeSelection={vi.fn()}
        renderableVariantAxes={['storage']}
        selectedAttributes={{}}
        variantCount={2}
        variants={[
          {
            attributes: { storage: null as never },
            id: 'variant-malformed',
            merchant_id: 'merchant-1',
            product_id: 'product-1',
            stock_quantity: 2,
          },
          {
            attributes: { storage: '256GB' },
            id: 'variant-256',
            merchant_id: 'merchant-1',
            product_id: 'product-1',
            stock_quantity: 2,
          },
        ]}
      />
    );

    expect(
      screen.getByRole('button', { name: /select 256gb storage/i })
    ).toBeInTheDocument();
  });

  it('renders nothing when there are no variant options', () => {
    const { container } = render(
      <OgabasseyPdpCriticalVariantSelectors
        onAttributeSelection={vi.fn()}
        renderableVariantAxes={[]}
        selectedAttributes={{}}
        variantCount={2}
        variants={[]}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
