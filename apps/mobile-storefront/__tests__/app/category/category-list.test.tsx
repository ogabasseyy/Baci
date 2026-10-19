import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import {
  getFlashListProps,
  mockAdSlotModule,
  mockExpoRouterModule,
  mockFlashListModule,
  mockHooksModule,
  mockLoadMore,
  mockProductCardModule,
  mockRefetch,
  mockRouterPush,
  mockStorefrontInsetsModule,
  mockStorefrontScreenShellModule,
  setProductsState,
  setupCategoryMocks,
} from './category.test-utils';

jest.mock('expo-router', () => mockExpoRouterModule());
jest.mock('@shopify/flash-list', () => mockFlashListModule());
jest.mock('@/components/storefront/StorefrontScreenShell', () =>
  mockStorefrontScreenShellModule()
);
jest.mock('@/hooks/use-storefront-insets', () => mockStorefrontInsetsModule());
jest.mock('@/hooks', () => mockHooksModule());
jest.mock('@/components/ads/AdSlot', () => mockAdSlotModule());
jest.mock('@/components/storefront/ProductCard', () => mockProductCardModule());

import CategoryScreen from '@/app/category/[slug]';

describe('CategoryScreen list behaviors', () => {
  beforeEach(() => {
    setupCategoryMocks();
  });

  it('calls loadMore when the list reaches the end and more products are available', () => {
    setProductsState({ hasMore: true });

    render(<CategoryScreen />);

    const flashListProps = getFlashListProps();

    flashListProps?.onEndReached?.();

    expect(mockLoadMore).toHaveBeenCalled();
  });

  it.each([
    {
      hasMore: true,
      isLoading: true,
      scenario: 'the list is already loading',
    },
    {
      hasMore: false,
      isLoading: false,
      scenario: 'there are no more products',
    },
  ])('does not call loadMore when $scenario', ({ hasMore, isLoading }) => {
    setProductsState({ hasMore, isLoading });

    render(<CategoryScreen />);

    const flashListProps = getFlashListProps();

    flashListProps?.onEndReached?.();

    expect(mockLoadMore).not.toHaveBeenCalled();
  });

  it('calls refetch when the list is pulled to refresh', async () => {
    render(<CategoryScreen />);

    const flashListProps = getFlashListProps();
    const onRefresh = flashListProps?.refreshControl?.props.onRefresh;

    expect(onRefresh).toBeDefined();

    if (onRefresh) {
      await act(async () => {
        await onRefresh();
      });
    }

    expect(mockRefetch).toHaveBeenCalled();
  });

  it('navigates to the product detail screen when a product is pressed', () => {
    render(<CategoryScreen />);

    fireEvent.press(screen.getByLabelText('Open test-product'));

    expect(mockRouterPush).toHaveBeenCalledWith('/product/test-product');
  });
});
