import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { act, render, waitFor } from '@testing-library/react-native';
import {
  primaryVariant,
  variantProduct,
} from '@/lib/product-route/product-detail-screen.fixtures';
import {
  getLastMockProps,
  mockProductDetailsBody,
  mockStickyBottomActions,
  mockUseEffectivePrice,
  mockUseLocalSearchParams,
  mockUseProduct,
  mockValidatedAddToCart,
  ProductDetailScreen,
  resetProductDetailScreenMocks,
} from '../../../test-support/product/product-detail-screen.test-utils';

describe('ProductDetailScreen variant cart behavior', () => {
  beforeAll(() => {
    expect(primaryVariant).toBeDefined();
  });

  beforeEach(() => {
    resetProductDetailScreenMocks();
  });

  it('adds unlimited-stock variants to cart when only the display selection resolves', async () => {
    mockUseLocalSearchParams.mockReturnValue({
      slug: 'samsung-galaxy-s24',
      condition: 'open_box',
    });
    mockUseProduct.mockReturnValue({
      product: {
        ...variantProduct,
        slug: 'samsung-galaxy-s24',
        manage_stock: false,
        variant_attributes: null,
        available_conditions: ['open_box', 'used'],
        variants: [
          {
            ...primaryVariant,
            id: 'variant-open-box-128',
            condition: 'open_box',
            price: 552000,
            stock_quantity: 0,
            attributes: {
              storage: '128GB',
            },
          },
        ],
      },
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });
    mockUseEffectivePrice.mockReturnValue({
      price: 552000,
      comparePrice: undefined,
    });

    render(<ProductDetailScreen />);

    await waitFor(() => {
      expect(getLastMockProps(mockStickyBottomActions)).toEqual(
        expect.objectContaining({
          canPurchase: true,
        })
      );
    });

    act(() => {
      getLastMockProps<{
        onAddToCart: (event?: {
          nativeEvent?: Record<string, unknown>;
        }) => void;
      }>(mockStickyBottomActions)?.onAddToCart({
        nativeEvent: {
          pageX: 180,
          pageY: 720,
        },
      });
    });

    expect(mockValidatedAddToCart).toHaveBeenCalledWith(
      expect.objectContaining({
        price: 552000,
        slug: 'samsung-galaxy-s24',
        storage: '128GB',
        variant_id: 'variant-open-box-128',
      })
    );
  });

  it('adds SKU-matrix SIM type, condition, and variant identity to cart from the PDP', async () => {
    mockUseLocalSearchParams.mockReturnValue({
      slug: 'iphone-15',
      condition: 'open_box',
    });
    mockUseProduct.mockReturnValue({
      product: {
        ...variantProduct,
        name: 'iPhone 15',
        slug: 'iphone-15',
        manage_stock: true,
        variant_attributes: {
          storage: ['128GB'],
          sim_type: ['eSIM Only'],
        },
        available_conditions: ['open_box', 'used'],
        variant_model: 'sku_matrix',
        variants: [
          {
            ...primaryVariant,
            id: 'iphone15-openbox-128-black-esim',
            condition: 'open_box',
            name: 'Open Box 128GB Black eSIM',
            price: 829000,
            price_override: 829000,
            stock_quantity: 3,
            attributes: {
              color: 'Black',
              sim_type: 'eSIM Only',
              storage: '128GB',
            },
          },
        ],
      },
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });
    mockUseEffectivePrice.mockReturnValue({
      price: 829000,
      comparePrice: undefined,
    });

    render(<ProductDetailScreen />);

    await waitFor(() => {
      expect(getLastMockProps(mockProductDetailsBody)).toEqual(
        expect.objectContaining({
          selectedCondition: 'open_box',
          selectedStorage: '128GB',
        })
      );
      expect(getLastMockProps(mockStickyBottomActions)).toEqual(
        expect.objectContaining({
          canPurchase: true,
        })
      );
    });

    act(() => {
      getLastMockProps<{
        onAddToCart: (event?: {
          nativeEvent?: Record<string, unknown>;
        }) => void;
      }>(mockStickyBottomActions)?.onAddToCart({
        nativeEvent: {
          pageX: 180,
          pageY: 720,
        },
      });
    });

    expect(mockValidatedAddToCart).toHaveBeenCalledWith(
      expect.objectContaining({
        condition: 'Open Box',
        price: 829000,
        slug: 'iphone-15',
        storage: '128GB',
        variant_attributes: expect.objectContaining({
          condition: 'Open Box',
          sim_type: 'eSIM Only',
          storage: '128GB',
        }),
        variant_id: 'iphone15-openbox-128-black-esim',
      })
    );
  });
});
