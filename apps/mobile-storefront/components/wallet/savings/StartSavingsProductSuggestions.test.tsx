import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { Product } from '@/types/product';
import { StartSavingsProductSuggestions } from './StartSavingsProductSuggestions';
import type { SavingsProductChoice } from './start-savings.types';
import type { StartSavingsController } from './start-savings-controller.types';

const product: Product = {
  condition: 'used',
  id: 'product-1',
  image: 'https://cdn.example.com/iphone.jpg',
  name: 'iPhone 13 Pro Max',
  price: 800000,
  slug: 'iphone-13-pro-max',
  variants: [
    {
      attributes: { storage: '256GB' },
      id: 'variant-256',
      name: '256GB',
      price: 850000,
    },
    { id: 'variant-512', name: '512GB', price: 950000 },
    { id: 'variant-invalid', name: 'Invalid', price: 0 },
  ],
};

function createController(
  overrides: Partial<StartSavingsController> = {}
): StartSavingsController {
  return {
    debouncedSearch: 'iphone',
    isProductsLoading: false,
    products: [product],
    selectProduct: jest.fn(),
    selectedProduct: null,
    ...overrides,
  } as StartSavingsController;
}

describe('StartSavingsProductSuggestions', () => {
  it('shows one device with its lowest valid variant price without picking a variant', () => {
    const controller = createController();

    render(
      <StartSavingsProductSuggestions
        colors={Colors.light}
        controller={controller}
      />
    );

    fireEvent.press(
      screen.getByRole('button', {
        name: 'Select iPhone 13 Pro Max',
      })
    );
    expect(controller.selectProduct).toHaveBeenCalledWith(product);
    expect(screen.getByText(/From.*850,000/)).toBeOnTheScreen();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('announces loading while a non-blank product search is pending', () => {
    render(
      <StartSavingsProductSuggestions
        colors={Colors.light}
        controller={createController({ isProductsLoading: true, products: [] })}
      />
    );

    expect(screen.getByLabelText('Loading savings products')).toBeOnTheScreen();
  });

  it('shows an empty result message when a non-blank search has no matches', () => {
    render(
      <StartSavingsProductSuggestions
        colors={Colors.light}
        controller={createController({ products: [] })}
      />
    );

    expect(screen.getByText('No matching products found.')).toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: /Select /i })
    ).not.toBeOnTheScreen();
  });

  it('does not show suggestions for a blank search', () => {
    render(
      <StartSavingsProductSuggestions
        colors={Colors.light}
        controller={createController({ debouncedSearch: '   ' })}
      />
    );

    expect(
      screen.queryByLabelText('Loading savings products')
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByText('No matching products found.')
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: /Select /i })
    ).not.toBeOnTheScreen();
  });

  it('hides suggestions after a product has been preselected', () => {
    const selectedProduct: SavingsProductChoice = {
      conditionLabel: 'Used',
      id: product.id,
      image: product.image,
      name: product.name,
      price: 850000,
      requiresVariantSelection: false,
      slug: product.slug,
      variantId: 'variant-256',
      variantLabel: 'Storage: 256GB',
    };

    render(
      <StartSavingsProductSuggestions
        colors={Colors.light}
        controller={createController({ selectedProduct })}
      />
    );

    expect(
      screen.queryByRole('button', { name: /Select /i })
    ).not.toBeOnTheScreen();
  });
});
