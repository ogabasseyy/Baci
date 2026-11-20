import Ionicons from '@react-native-vector-icons/ionicons';
import { FlashList } from '@shopify/flash-list';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AdSlot } from '@/components/ads/AdSlot';
import { ProductCard } from '@/components/storefront/ProductCard';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND } from '@/constants/Colors';
import { useCategories, useProducts } from '@/hooks';
import { useStorefrontInsets } from '@/hooks/use-storefront-insets';
import type { Product } from '@/types/product';

const handleProductPress = (product: Product): void => {
  router.push(`/product/${product.slug}`);
};

const getCategoryTitle = (slug: string): string => {
  // BUG-2-005 FIX: Add basic sanitization and fallback to "Category"
  if (!slug || typeof slug !== 'string' || slug.trim().length === 0) {
    return 'Category';
  }

  const titles: Record<string, string> = {
    all: 'All Products',
    iphones: 'iPhones',
    samsung: 'Samsung',
    laptops: 'Laptops',
    accessories: 'Accessories',
    tablets: 'Tablets',
    smartwatches: 'Smart Watches',
  };

  // Basic sanitization: remove special chars except hyphens
  const sanitized = slug.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();

  return (
    titles[sanitized] ||
    sanitized.charAt(0).toUpperCase() + sanitized.slice(1).replace(/-/g, ' ') ||
    'Category'
  );
};

const PHONE_CATEGORY_SLUGS = ['phones', 'smartphones', 'mobile-phones'];

export default function CategoryScreen() {
  const { slug: slugParam, sort } = useLocalSearchParams<{
    slug: string;
    sort?: string;
  }>();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { getListContentStyle } = useStorefrontInsets();

  const slug =
    typeof slugParam === 'string' ? slugParam.trim().toLowerCase() : '';
  const isValidSlug = Boolean(slug);

  // H10 FIX: Resolve category slug to UUID since Supabase query uses category_id
  const { data: categories = [], isLoading: categoriesLoading } =
    useCategories();
  // Prefer the exact slug, then the catalog preference in PHONE_CATEGORY_SLUGS.
  const categoryId =
    categories.find((category) => category.slug === slug)?.id ??
    (PHONE_CATEGORY_SLUGS.includes(slug)
      ? PHONE_CATEGORY_SLUGS.map(
          (alias) => categories.find((category) => category.slug === alias)?.id
        ).find(Boolean)
      : undefined);
  const isCategoryResolved = slug === 'all' || Boolean(categoryId);
  // Accept web price-sort aliases while keeping the catalog's RPC keys.
  const normalizedSort =
    sort === 'price-asc'
      ? 'price_asc'
      : sort === 'price-desc'
        ? 'price_desc'
        : sort;
  const sortBy =
    normalizedSort === 'price_asc' ||
    normalizedSort === 'price_desc' ||
    normalizedSort === 'newest'
      ? normalizedSort
      : undefined;

  const { products, isLoading, error, hasMore, refetch, loadMore } =
    useProducts({
      category: isValidSlug ? categoryId : undefined,
      limit: 20,
      sortBy,
      enabled: isValidSlug && !categoriesLoading && isCategoryResolved,
    });

  const [refreshing, setRefreshing] = React.useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleLoadMore = () => {
    if (!isLoading && hasMore) {
      loadMore();
    }
  };

  const renderProduct = ({ item, index }: { item: Product; index: number }) => (
    <View
      style={[
        styles.productWrapper,
        index % 2 === 0 ? styles.productLeft : styles.productRight,
      ]}
    >
      <ProductCard product={item} onPress={() => handleProductPress(item)} />
    </View>
  );

  // The MPU mounts only on a valid, successfully resolved category with at
  // least one product: while the slug is invalid or unresolved, products
  // are loading, the fetch errored, or a successful query returned zero
  // products, FlashList renders the footer alongside the empty component
  // and the slot would request under an invalid/loading/error/empty
  // message. The supported 'all' slug intentionally resolves no category
  // ID (the catalog fetch is unfiltered), so it counts as resolved;
  // unknown slugs stay withheld.
  const canShowCategoryMpu =
    isValidSlug &&
    !categoriesLoading &&
    isCategoryResolved &&
    !isLoading &&
    !error &&
    products.length > 0;

  const renderFooter = () => {
    if (!canShowCategoryMpu) return null;
    // The MPU renders independently of pagination: categories that fit in the
    // initial page (or finish loading) must still show the placement.
    // AdSlot renders nothing while ads are disabled or misconfigured.
    if (!hasMore) {
      return <AdSlot placement="PRODUCT_GRID_MPU" />;
    }
    return (
      <View>
        <AdSlot placement="PRODUCT_GRID_MPU" />
        <View style={styles.footer}>
          <ActivityIndicator size="small" color={BRAND.primary} />
        </View>
      </View>
    );
  };

  const renderEmpty = () => {
    // BUG-2-004 FIX: Show error for invalid slug
    if (!isValidSlug || (!categoriesLoading && !isCategoryResolved)) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons
            name="alert-circle-outline"
            size={48}
            color={colors.textSecondary}
          />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            Invalid Category
          </Text>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            This category link is not valid. Please try browsing from the home
            page.
          </Text>
        </View>
      );
    }

    if (categoriesLoading || isLoading) {
      return (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={BRAND.primary} />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            Loading products…
          </Text>
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons
            name="alert-circle-outline"
            size={48}
            color={colors.textSecondary}
          />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            Something went wrong
          </Text>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            {error}
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="bag-outline" size={48} color={colors.textSecondary} />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>
          No products found
        </Text>
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          Check back later for products in this category
        </Text>
      </View>
    );
  };

  return (
    <StorefrontScreenShell
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['bottom']}
    >
      <Stack.Screen
        options={{
          title: getCategoryTitle(slug || ''),
        }}
      />
      <FlashList
        data={products}
        renderItem={renderProduct}
        keyExtractor={(item) => item.id}
        numColumns={2}
        ListFooterComponent={renderFooter}
        ListEmptyComponent={renderEmpty}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={BRAND.primary}
            colors={[BRAND.primary]}
          />
        }
        contentContainerStyle={getListContentStyle({
          includeBottomInset: false,
          paddingBottom: 24,
          paddingTop: 16,
        })}
        showsVerticalScrollIndicator={false}
      />
    </StorefrontScreenShell>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  productWrapper: {
    flex: 1,
  },
  productLeft: {
    paddingRight: 8,
  },
  productRight: {
    paddingLeft: 8,
  },
  footer: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  emptyContainer: {
    paddingVertical: 60,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 8,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    maxWidth: 280,
  },
});
