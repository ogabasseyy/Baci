import type { ListRenderItemInfo } from '@shopify/flash-list';
import { router } from 'expo-router';
import { type RefObject, useState } from 'react';
import {
  ActivityIndicator,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  StyleSheet,
  View,
} from 'react-native';
import { CategoryItem } from '@/components/product/CategoryItem';
import { ProductItem } from '@/components/product/ProductItem';
import { ProductsListEmpty } from '@/components/product/ProductsListEmpty';
import { ProductsListShell } from '@/components/product/ProductsListShell';
import { ProductsStatCards } from '@/components/product/ProductsStatCards';
import {
  ProductsSubTabs,
  type ProductsTab,
} from '@/components/product/ProductsSubTabs';
import type { Category } from '@/components/product/product.shared';
import { getProductsEmptyState } from '@/components/product/products-empty-state';
import { TopSellingProductItem } from '@/components/product/TopSellingProductItem';
import { SPACING } from '@/constants/theme';
import {
  type Product,
  type StockFilter,
  useCategories,
  useInventoryStats,
  useProducts,
} from '@/hooks/useProducts';
import { useTheme } from '@/hooks/useTheme';
import {
  type TopSellingProduct,
  useTopSellingProducts,
} from '@/hooks/useTopSellingProducts';
import {
  categoryKeyExtractor,
  handleCategoryPress,
  handleProductPress,
  productKeyExtractor,
  topSellingKeyExtractor,
} from './products-tab-page.helpers';

interface ProductsTabPageProps {
  currencySymbol: string;
  onClearSearch: () => void;
  onOpenCreateCategory: () => void;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onSubTabChange: (subTab: ProductsTab) => void;
  searchQuery: string;
  variant: 'in_stock' | 'on_website';
  scrollRef?: RefObject<{
    scrollToOffset: (options: { offset: number; animated?: boolean }) => void;
  } | null>;
}

export function ProductsTabPage({
  currencySymbol,
  onClearSearch,
  onOpenCreateCategory,
  onScroll,
  onSubTabChange,
  searchQuery,
  variant,
  scrollRef,
}: ProductsTabPageProps) {
  const { colors } = useTheme();
  const [activeTab, setActiveTab] = useState<ProductsTab>(
    variant === 'in_stock' ? 'in_stock' : 'all'
  );

  const handleSubTabSelect = (tab: ProductsTab) => {
    setActiveTab(tab);
    onSubTabChange(tab);
  };

  // Map the sub-tab to a server-side stock filter
  const stockFilter: StockFilter | undefined =
    activeTab === 'in_stock' ||
    activeTab === 'low_stock' ||
    activeTab === 'out_of_stock'
      ? activeTab
      : undefined;

  const {
    data,
    isLoading: isProductsLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch: refetchProducts,
    error: productsError,
  } = useProducts({
    stockFilter,
    search: searchQuery.trim() || undefined,
  });

  const {
    data: categories,
    isLoading: isCategoriesLoading,
    refetch: refetchCategories,
  } = useCategories();
  const {
    data: topSellingProducts,
    isLoading: isTopSellingLoading,
    refetch: refetchTopSelling,
  } = useTopSellingProducts(20);
  const { data: inventoryStats } = useInventoryStats();

  const displayData = data?.pages.flatMap((page) => page.products) ?? [];
  const itemsCount =
    variant === 'in_stock'
      ? (inventoryStats?.activeCount ?? 0)
      : (inventoryStats?.totalProducts ?? data?.pages[0]?.totalCount ?? 0);

  const handleLoadMore = () => {
    if (hasNextPage && !isFetchingNextPage && activeTab !== 'top_selling') {
      fetchNextPage();
    }
  };

  const renderProduct = ({ item }: ListRenderItemInfo<Product>) => (
    <ProductItem
      item={item}
      currencySymbol={currencySymbol}
      onPress={handleProductPress}
    />
  );
  const renderTopSellingProduct = ({
    item,
  }: ListRenderItemInfo<TopSellingProduct>) => (
    <TopSellingProductItem
      item={item}
      currencySymbol={currencySymbol}
      onPress={handleProductPress}
    />
  );
  const renderCategory = ({ item }: ListRenderItemInfo<Category>) => (
    <CategoryItem item={item} onPress={handleCategoryPress} />
  );

  const emptyState = getProductsEmptyState({
    activeTab,
    searchQuery,
    variant,
  });
  const emptyAction =
    emptyState.action === 'clear_search'
      ? onClearSearch
      : emptyState.action === 'add_product'
        ? () => router.push('/product/new')
        : null;
  const productsEmptyProps = productsError
    ? {
        buttonHint: 'Retries loading products',
        buttonLabel: 'Try Again',
        description: 'Refresh the page or try again in a moment.',
        icon: 'alert-circle-outline' as const,
        onButtonPress: () => void refetchProducts(),
        showButtonIcon: false,
        title: "Couldn't load products",
      }
    : {
        buttonHint:
          emptyState.action === 'clear_search'
            ? 'Resets search query'
            : 'Opens form to create a new product',
        buttonLabel: emptyState.buttonLabel,
        description: emptyState.description,
        icon: emptyState.icon,
        onButtonPress: emptyAction,
        showButtonIcon: emptyState.action !== 'clear_search',
        title: emptyState.title,
      };

  return (
    <View style={styles.page}>
      <ProductsStatCards activeTab={variant} />

      <ProductsSubTabs
        activeTab={activeTab}
        counts={{
          categories: categories?.length ?? 0,
          items: itemsCount,
          lowStock: inventoryStats?.lowStockCount ?? 0,
          outOfStock: inventoryStats?.outOfStockCount ?? 0,
        }}
        onSelect={handleSubTabSelect}
        variant={variant}
      />

      {activeTab === 'categories' ? (
        <ProductsListShell
          colors={colors}
          data={categories}
          renderItem={renderCategory}
          keyExtractor={categoryKeyExtractor}
          refreshing={isCategoriesLoading}
          onRefresh={refetchCategories}
          emptyComponent={
            !isCategoriesLoading ? (
              <ProductsListEmpty
                buttonHint="Opens form to create a new product category"
                buttonLabel="Create Category"
                icon="folder-open-outline"
                onButtonPress={onOpenCreateCategory}
                title="No categories found"
              />
            ) : null
          }
          onScroll={onScroll}
          scrollRef={scrollRef}
        />
      ) : activeTab === 'top_selling' ? (
        <ProductsListShell
          colors={colors}
          data={topSellingProducts}
          renderItem={renderTopSellingProduct}
          keyExtractor={topSellingKeyExtractor}
          refreshing={isTopSellingLoading}
          onRefresh={refetchTopSelling}
          emptyComponent={
            !isTopSellingLoading ? (
              <ProductsListEmpty
                description="Start selling to see top products here."
                icon="trophy-outline"
                title="No sales yet"
              />
            ) : (
              <ActivityIndicator
                accessibilityLabel="Loading top selling products"
                size="large"
                color={colors.gold}
                style={{ marginTop: 20 }}
              />
            )
          }
          onScroll={onScroll}
          scrollRef={scrollRef}
        />
      ) : (
        <ProductsListShell
          colors={colors}
          data={displayData}
          renderItem={renderProduct}
          keyExtractor={productKeyExtractor}
          refreshing={isProductsLoading}
          onRefresh={refetchProducts}
          onEndReached={handleLoadMore}
          onScroll={onScroll}
          scrollRef={scrollRef}
          footerComponent={
            isFetchingNextPage ? (
              <View style={styles.footerLoader}>
                <ActivityIndicator color={colors.gold} />
              </View>
            ) : null
          }
          emptyComponent={
            !isProductsLoading ? (
              <ProductsListEmpty {...productsEmptyProps} />
            ) : (
              <ActivityIndicator
                accessibilityLabel="Loading products"
                size="large"
                color={colors.gold}
                style={{ marginTop: 20 }}
              />
            )
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  footerLoader: {
    alignItems: 'center',
    paddingVertical: SPACING.lg,
  },
  page: {
    flex: 1,
  },
});
