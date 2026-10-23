import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CartVariantDetails } from './cart-variant-details';

describe('CartVariantDetails', () => {
  it('shows the exact iPhone SKU with labelled storage, SIM type, condition and colour', () => {
    render(
      <CartVariantDetails
        item={{
          condition: 'new',
          variantAttributes: {
            storage: '512GB',
            sim_type: 'Physical + eSIM',
            color: 'Silver',
            color_hex: '#eee',
          },
        }}
      />
    );
    for (const text of [
      'Storage:',
      '512GB',
      'SIM type:',
      'Physical + eSIM',
      'Condition:',
      'New',
      'Colour:',
      'Silver',
    ]) {
      expect(screen.getByText(text)).toBeVisible();
    }
    expect(screen.queryByText('#eee')).not.toBeInTheDocument();
  });
  it('canonicalizes saved attribute aliases and prefers them to stale legacy fields', () => {
    render(
      <CartVariantDetails
        item={{
          selectedColor: 'Blue',
          selectedStorage: '256GB',
          variantAttributes: {
            'SIM Type': 'Physical + eSIM',
            colour: 'Silver',
            storage_capacity: '512GB',
            condition: 'open_box',
          },
        }}
      />
    );
    for (const text of ['Physical + eSIM', 'Silver', '512GB', 'Open Box'])
      expect(screen.getByText(text)).toBeVisible();
    expect(screen.queryByText('Blue')).not.toBeInTheDocument();
  });
  it('supports legacy cart fields without inventing missing SIM details', () => {
    render(
      <CartVariantDetails
        item={{
          selectedColor: 'Silver',
          selectedStorage: '512GB',
          condition: 'used',
        }}
      />
    );
    expect(screen.getByText('Used')).toBeVisible();
    expect(screen.getByText('Silver')).toBeVisible();
    expect(screen.queryByText('SIM type:')).not.toBeInTheDocument();
  });
  it('renders nothing for an item without variant details', () => {
    const { container } = render(<CartVariantDetails item={{}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

it('uses the storefront theme for variant text', () => {
  render(<CartVariantDetails item={{ selectedStorage: '512GB' }} />);
  expect(screen.getByLabelText('Selected variant')).toHaveClass(
    'text-store-background-text/70'
  );
});

it('shows additional SKU axes and ignores malformed saved values', () => {
  render(
    <CartVariantDetails
      item={{
        variantAttributes: JSON.parse(
          '{"storage":null,"ram":"8GB","size":"L","material":"Cotton"}'
        ),
      }}
    />
  );
  for (const text of ['RAM:', '8GB', 'Size:', 'L', 'Material:', 'Cotton'])
    expect(screen.getByText(text)).toBeVisible();
  expect(screen.queryByText('Storage:')).not.toBeInTheDocument();
});

it('hides shared-cart compatibility metadata and shows one second colour preference', () => {
  render(
    <CartVariantDetails
      item={{
        secondaryColor: 'Blue',
        variantAttributes: {
          color: 'Silver',
          colorValue: '#eee',
          secondaryColor: 'Blue',
          secondaryColorValue: '#00f',
          ram: '8GB',
        },
      }}
    />
  );
  expect(screen.getByText('Silver')).toBeVisible();
  expect(screen.getAllByText('Blue')).toHaveLength(1);
  expect(screen.getByText('8GB')).toBeVisible();
  expect(
    screen.queryByText(/#eee|#00f|Color value:|Secondary color:/)
  ).not.toBeInTheDocument();
});
it.each([
  'used',
  'open_box',
  'new',
])('omits a synthesized variant repeating condition %s', (condition) => {
  const variant = { used: 'Used', open_box: 'Open Box', new: 'New' }[
    condition
  ]!;
  render(
    <CartVariantDetails item={{ variantAttributes: { condition, variant } }} />
  );
  expect(screen.getByText(variant)).toBeVisible();
  expect(screen.queryByText('Variant:')).not.toBeInTheDocument();
});
