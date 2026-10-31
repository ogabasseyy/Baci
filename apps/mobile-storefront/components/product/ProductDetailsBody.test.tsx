import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { baseProduct } from '@/lib/product-route/product-detail-screen.fixtures';
import type { ProductDetailsBodyProps } from './ProductDetailsBody';
import { ProductDetailsBody } from './ProductDetailsBody';

jest.mock('@/components/product/ConditionSelector', () => ({
  ConditionSelector: () => null,
}));

jest.mock('@/components/product/ReviewsList', () => ({
  ReviewsList: () => null,
}));

jest.mock('@/components/product/VariantSelector', () => ({
  VariantSelector: () => null,
}));

jest.mock('@/components/ui/HTMLRenderer', () => ({
  HTMLRenderer: () => null,
}));

const mockReducedMotion = jest.fn<() => boolean>(() => false);
const mockAnimatedViewProps = jest.fn();

jest.mock('react-native-reanimated', () => {
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');

  const React = jest.requireActual<typeof import('react')>('react');
  const AnimatedView = (props: import('react-native').ViewProps) => {
    mockAnimatedViewProps(props);
    return React.createElement(View, props);
  };
  return {
    __esModule: true,
    default: { View: AnimatedView },
    useReducedMotion: () => mockReducedMotion(),
    View,
    FadeInDown: {
      delay: () => ({
        duration: () => ({}),
      }),
    },
  };
});

function createProps(
  overrides: Partial<ProductDetailsBodyProps> = {}
): ProductDetailsBodyProps {
  return {
    availableConditions: [],
    conditionOffers: [],
    product: {
      ...baseProduct,
      description: 'Premium smartphone',
    },
    effectivePrice: 552000,
    effectiveComparePrice: undefined,
    selectedVariant: null,
    setSelectedVariant: jest.fn(),
    selectedCondition: null,
    setSelectedCondition: jest.fn(),
    selectedAttributes: {},
    selectedColor: null,
    selectedStorage: null,
    onSelectAttribute: jest.fn(),
    onSelectColor: jest.fn(),
    onSelectStorage: jest.fn(),
    reviews: [],
    reviewStats: null,
    reviewsLoading: false,
    hasMoreReviews: false,
    loadMoreReviews: jest.fn(async () => undefined),
    onMarkHelpful: jest.fn(),
    colors: Colors.light,
    ...overrides,
  };
}

describe('ProductDetailsBody', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReducedMotion.mockReturnValue(false);
  });

  it('shows essential product content immediately when reduced motion disables entering animations', () => {
    mockReducedMotion.mockReturnValue(true);
    render(<ProductDetailsBody {...createProps()} />);
    expect(screen.getByText(baseProduct.name)).toBeOnTheScreen();
    expect(mockAnimatedViewProps).toHaveBeenCalledWith(
      expect.objectContaining({ entering: undefined })
    );
  });

  it('retains the entrance animation when motion is enabled', () => {
    render(<ProductDetailsBody {...createProps()} />);
    expect(mockAnimatedViewProps).toHaveBeenCalledWith(
      expect.objectContaining({ entering: expect.any(Object) })
    );
  });

  it('renders the product summary without an in-page negotiation CTA (negotiation lives in the cart)', () => {
    render(<ProductDetailsBody {...createProps()} />);

    expect(screen.getByText(baseProduct.name)).toBeTruthy();
    // Negotiation moved to the cart — no offer CTA or negotiated badge on the PDP.
    expect(screen.queryByRole('button', { name: 'Make an Offer' })).toBeNull();
    expect(screen.queryByText('Your negotiated price!')).toBeNull();
    // Purchase actions live in the screen footer, not the body.
    expect(screen.queryByRole('button', { name: 'Add to Cart' })).toBeNull();
  });

  it('renders no negotiation UI for non-negotiable budget-brand products', () => {
    render(
      <ProductDetailsBody
        {...createProps({
          product: {
            ...baseProduct,
            brand: 'Tecno',
            name: 'Tecno Spark 50',
            description: 'Budget smartphone',
          },
        })}
      />
    );

    expect(screen.getByText('Tecno Spark 50')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Make an Offer' })).toBeNull();
  });
});
