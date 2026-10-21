import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import {
  baseProduct,
  variantProduct,
} from '@/lib/product-route/product-detail-screen.fixtures';
import type { Product } from '@/types/product';
import {
  findNodeWithContentPadding,
  getLastMockProps,
  MIN_STICKY_BOTTOM_PADDING,
  mockInsets,
  mockProductDetailsBody,
  mockRouterReplace,
  mockStickyBottomActions,
  mockUseEffectivePrice,
  mockUseLocalSearchParams,
  mockUseProduct,
  PRODUCT_SCROLL_BOTTOM_PADDING,
  ProductDetailScreen,
  resetProductDetailScreenMocks,
} from '../../../test-support/product/product-detail-screen.test-utils';

describe('ProductDetailScreen routing and selection sync', () => {
  beforeEach(() => {
    resetProductDetailScreenMocks();
  });

  it('redirects to the canonical product slug when the fetched slug differs', async () => {
    mockUseProduct.mockReturnValue({
      product: {
        ...baseProduct,
        slug: 'iphone-13-pro',
      },
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });

    render(<ProductDetailScreen />);

    await waitFor(() => {
      expect(mockRouterReplace).toHaveBeenCalledWith({
        pathname: '/product/[slug]',
        params: { slug: 'iphone-13-pro' },
      });
    });
  });

  it('does not redirect when the route slug is already canonical', async () => {
    mockUseLocalSearchParams.mockReturnValue({ slug: 'iphone-13-pro' });

    render(<ProductDetailScreen />);

    await waitFor(() => {
      expect(mockProductDetailsBody).toHaveBeenCalled();
    });

    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it('does not redirect when product data is unavailable', async () => {
    mockUseProduct.mockReturnValue({
      product: null,
      isLoading: false,
      error: 'Not found',
      refetch: jest.fn(),
    });

    render(<ProductDetailScreen />);

    await waitFor(() => {
      expect(screen.getAllByText('Product not found').length).toBeGreaterThan(
        0
      );
    });

    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it('resets attribute-only variant params back to the bare product route', async () => {
    mockUseLocalSearchParams.mockReturnValue({
      slug: 'iphone-13-pro',
      storage: '128GB',
      utm_source: 'google',
    });
    mockUseProduct.mockReturnValue({
      product: variantProduct,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });
    mockUseEffectivePrice.mockReturnValue({
      price: variantProduct.price,
      comparePrice: undefined,
    });

    render(<ProductDetailScreen />);

    await waitFor(() => {
      expect(mockRouterReplace).toHaveBeenCalledWith('/product/iphone-13-pro');
    });
  });

  it('ignores unrelated route params when deciding whether to reset selection', async () => {
    mockUseLocalSearchParams.mockReturnValue({
      slug: 'iphone-13-pro',
      utm_source: 'google',
    });
    mockUseProduct.mockReturnValue({
      product: variantProduct,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });
    mockUseEffectivePrice.mockReturnValue({
      price: variantProduct.price,
      comparePrice: undefined,
    });

    render(<ProductDetailScreen />);

    await waitFor(() => {
      expect(mockProductDetailsBody).toHaveBeenCalled();
    });

    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it('preselects the first advertised storage option when no default variant can be resolved', async () => {
    mockUseLocalSearchParams.mockReturnValue({
      slug: 'galaxy-tab-a11-plus-5g',
    });
    mockUseProduct.mockReturnValue({
      product: {
        ...baseProduct,
        id: 'product-variant-parent',
        name: 'Samsung Galaxy Tab A11+ 5G',
        slug: 'galaxy-tab-a11-plus-5g',
        has_variants: true,
        variant_attributes: {
          storage: ['128GB', '256GB'],
        },
        variants: [],
        color_images: {
          Gray: ['https://cdn.example.com/galaxy-tab-a11-plus-gray.jpg'],
        },
      },
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });

    render(<ProductDetailScreen />);

    await waitFor(() => {
      expect(getLastMockProps(mockProductDetailsBody)).toEqual(
        expect.objectContaining({
          selectedColor: 'Gray',
          selectedStorage: '128GB',
        })
      );
    });
  });

  it('re-syncs selection when variant rows arrive later for the same product id', async () => {
    mockUseLocalSearchParams.mockReturnValue({
      slug: 'samsung-galaxy-s26-ultra',
    });

    let currentProduct: Product | null = {
      ...baseProduct,
      id: 'product-s26-ultra',
      name: 'Samsung Galaxy S26 Ultra',
      slug: 'samsung-galaxy-s26-ultra',
      has_variants: true,
      variant_attributes: {
        storage: ['256GB', '512GB', '1TB'],
      },
      variants: [],
      color_images: {
        Black: ['https://cdn.example.com/s26-ultra-black.jpg'],
      },
    };

    mockUseProduct.mockImplementation(() => ({
      product: currentProduct,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    }));

    const view = render(<ProductDetailScreen />);

    await waitFor(() => {
      expect(getLastMockProps(mockProductDetailsBody)).toEqual(
        expect.objectContaining({
          selectedColor: 'Black',
          selectedStorage: '256GB',
        })
      );
    });

    currentProduct = {
      ...currentProduct,
      variants: [
        {
          id: 'variant-256gb',
          name: '256GB',
          price: 1656000,
          stock_quantity: 5,
          attributes: { ram: '12GB', storage: '256GB' },
        },
        {
          id: 'variant-512gb',
          name: '512GB',
          price: 1892000,
          stock_quantity: 5,
          attributes: { ram: '12GB', storage: '512GB' },
        },
      ],
    };

    view.rerender(<ProductDetailScreen />);

    await waitFor(() => {
      const latestCall =
        mockProductDetailsBody.mock.calls[
          mockProductDetailsBody.mock.calls.length - 1
        ];
      expect(latestCall?.[0]).toMatchObject({
        selectedColor: 'Black',
        selectedStorage: '256GB',
        selectedVariant: 'variant-256gb',
      });
    });
  });

  it('keeps the product screen inside safe-area bounds', async () => {
    const view = render(<ProductDetailScreen />);

    await waitFor(() => {
      expect(mockProductDetailsBody).toHaveBeenCalled();
    });

    const renderedTree = view.toJSON();
    expect(renderedTree).not.toBeNull();
    expect(Array.isArray(renderedTree)).toBe(false);
    const renderedRoot = Array.isArray(renderedTree)
      ? renderedTree[0]
      : renderedTree;
    const containerStyle = StyleSheet.flatten(renderedRoot?.props.style);

    expect(containerStyle?.marginTop).toBeUndefined();
    expect(containerStyle?.marginBottom).toBeUndefined();
    // Safe-area padding is not user-visible in this mocked tree, so these
    // implementation-detail assertions verify the inset values passed to the
    // sticky action bar and scroll content padding.
    expect(getLastMockProps(mockStickyBottomActions)).toEqual(
      expect.objectContaining({
        paddingBottom: Math.max(mockInsets.bottom, MIN_STICKY_BOTTOM_PADDING),
      })
    );
    expect(
      findNodeWithContentPadding(
        renderedTree,
        PRODUCT_SCROLL_BOTTOM_PADDING + mockInsets.bottom
      )
    ).not.toBeNull();
  });
});
