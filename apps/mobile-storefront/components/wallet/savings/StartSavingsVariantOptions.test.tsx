import { describe, expect, it, jest } from '@jest/globals';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { Product } from '@/types/product';
import { StartSavingsVariantOptions } from './StartSavingsVariantOptions';
import type { StartSavingsController } from './start-savings-controller.types';

const product: Product = {
  id: 'product-1',
  image: 'https://cdn.example.com/iphone.jpg',
  name: 'iPhone 13 Pro Max',
  price: 800000,
  slug: 'iphone-13-pro-max',
  variants: [
    {
      attributes: { storage: '128GB' },
      id: 'variant-128',
      name: '128GB',
      price: 750000,
    },
    {
      attributes: { storage: '256GB' },
      id: 'variant-256',
      name: '256GB',
      price: 850000,
    },
  ],
};

function createController(
  overrides: Partial<StartSavingsController> = {}
): StartSavingsController {
  return {
    selectProduct: jest.fn(),
    selectedCatalogProduct: product,
    selectedProduct: {
      id: product.id,
      image: product.image,
      name: product.name,
      price: 750000,
      requiresVariantSelection: false,
      slug: product.slug,
      variantId: 'variant-128',
      variantLabel: 'Storage: 128GB',
    },
    ...overrides,
  } as StartSavingsController;
}

describe('StartSavingsVariantOptions', () => {
  it('gives long exact variant attributes a full-width multiline card and a separate price', () => {
    const controller = createController({
      selectedCatalogProduct: {
        ...product,
        variants: [
          {
            id: 'blue-512',
            name: 'Blue 512GB',
            condition: 'new',
            attributes: { color: 'Blue', storage: '512GB' },
            price: 320000,
          },
        ],
      },
    });
    render(
      <StartSavingsVariantOptions
        colors={Colors.light}
        controller={controller}
      />
    );
    const card = screen.getByRole('button', {
      name: 'Select iPhone 13 Pro Max New · Color: Blue · Storage: 512GB',
    });
    expect(card).toHaveStyle({ width: '100%' });
    const attributes = within(card).getByText(/Color: Blue/);
    expect(attributes.props.children).toBe('New\nColor: Blue\nStorage: 512GB');
    expect(attributes.props.numberOfLines).toBeUndefined();
    expect(within(card).getByText('₦320,000')).toBeOnTheScreen();
  });
  it('switches the selected variant without keeping another variant price', () => {
    const controller = createController();

    render(
      <StartSavingsVariantOptions
        colors={Colors.light}
        controller={controller}
      />
    );

    fireEvent.press(
      screen.getByRole('button', {
        name: 'Select iPhone 13 Pro Max Storage: 256GB',
      })
    );

    expect(controller.selectProduct).toHaveBeenCalledWith(
      product,
      'variant-256'
    );
  });

  it('renders nothing when no catalog product has been selected', () => {
    render(
      <StartSavingsVariantOptions
        colors={Colors.light}
        controller={createController({ selectedCatalogProduct: null })}
      />
    );

    expect(screen.queryByText('Choose exact variant')).not.toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: /Select /i })
    ).not.toBeOnTheScreen();
  });

  it('renders nothing when the selected catalog product has no variants', () => {
    render(
      <StartSavingsVariantOptions
        colors={Colors.light}
        controller={createController({
          selectedCatalogProduct: { ...product, variants: [] },
        })}
      />
    );

    expect(screen.queryByText('Choose exact variant')).not.toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: /Select /i })
    ).not.toBeOnTheScreen();
  });

  it('allows selecting an out-of-stock device to save for future sourcing', () => {
    const controller = createController({
      selectedCatalogProduct: {
        ...product,
        variants: [
          {
            attributes: { storage: '128GB' },
            id: 'variant-128',
            in_stock: false,
            name: '128GB',
            price: 750000,
          },
        ],
      },
      selectedProduct: null,
    });

    render(
      <StartSavingsVariantOptions
        colors={Colors.light}
        controller={controller}
      />
    );

    const unavailableOption = screen.getByRole('button', {
      name: 'Select iPhone 13 Pro Max Storage: 128GB',
    });
    expect(unavailableOption).toBeEnabled();
    expect(
      screen.queryByText('Storage: 128GB unavailable')
    ).not.toBeOnTheScreen();

    fireEvent.press(unavailableOption);

    expect(controller.selectProduct).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'product-1' }),
      'variant-128'
    );
  });
});
