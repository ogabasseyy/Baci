import Ionicons from '@react-native-vector-icons/ionicons';
import { Image } from 'expo-image';
import type { Href } from 'expo-router';
import { router } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import categoryPlaceholderImage from '@/assets/images/icon.png';
import { OfflineEmptyState, OfflineNotice } from '@/components/OfflineNotice';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND, RADIUS, SPACING } from '@/constants/Colors';
import { useCategories } from '@/hooks';
import { useNetworkState } from '@/hooks/use-network-state';

const handleCategoryPress = (slug: string): void => {
  router.push(`/category/${slug}` as Href);
};

export default function CategoriesScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const {
    data: categories = [],
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useCategories();
  // Note: Manual onReconnect refetch removed — onlineManager.setOnline(true)
  // combined with refetchOnReconnect: true handles automatic refetching.
  const { isOnline } = useNetworkState();

  if (isLoading) {
    return (
      <StorefrontScreenShell
        edges={['top']}
        style={[styles.centered, { backgroundColor: colors.background }]}
      >
        <ActivityIndicator size="large" color={BRAND.primary} />
      </StorefrontScreenShell>
    );
  }

  // Error state with retry button
  if (isError) {
    return (
      <StorefrontScreenShell
        edges={['top']}
        style={[styles.centered, { backgroundColor: colors.background }]}
      >
        {!isOnline ? (
          <OfflineEmptyState
            title="Can't load categories"
            description="Connect to the internet to browse categories."
            showRetry
            onRetry={() => refetch()}
            isRetrying={isRefetching}
          />
        ) : (
          <View style={styles.errorContainer}>
            <Ionicons
              name="alert-circle-outline"
              size={48}
              color={colors.textSecondary}
            />
            <Text style={[styles.errorTitle, { color: colors.text }]}>
              Something went wrong
            </Text>
            <Text
              style={[styles.errorSubtitle, { color: colors.textSecondary }]}
            >
              We couldn't load categories. Please try again.
            </Text>
            <Pressable
              style={[styles.retryButton, { backgroundColor: BRAND.primary }]}
              onPress={() => refetch()}
              disabled={isRefetching}
              accessibilityRole="button"
              accessibilityLabel="Try again"
            >
              {isRefetching ? (
                <ActivityIndicator size="small" color={BRAND.onPrimary} />
              ) : (
                <>
                  <Ionicons
                    name="refresh-outline"
                    size={18}
                    color={BRAND.onPrimary}
                  />
                  <Text style={styles.retryButtonText}>Try Again</Text>
                </>
              )}
            </Pressable>
          </View>
        )}
      </StorefrontScreenShell>
    );
  }

  interface Category {
    id: string;
    slug: string;
    name: string;
    image_url?: string;
  }

  // categoryCard height calculation:
  // padding 12 (top + bottom) = 24
  // borderWidth 1 (top + bottom) = 2
  // inner image height = 64
  // Total item height = 90
  // Separator height = 12
  const CATEGORY_ITEM_HEIGHT = 90;
  const CATEGORY_ITEM_GAP = 12;
  const CATEGORY_ITEM_FULL_HEIGHT = CATEGORY_ITEM_HEIGHT + CATEGORY_ITEM_GAP;

  const getItemLayout = (
    _data: ArrayLike<Category> | null | undefined,
    index: number
  ) => ({
    length: CATEGORY_ITEM_FULL_HEIGHT,
    offset: CATEGORY_ITEM_FULL_HEIGHT * index,
    index,
  });

  const renderCategory = ({ item }: { item: Category }) => (
    <Pressable
      style={({ pressed }) => [
        styles.categoryCard,
        { backgroundColor: colors.card, borderColor: colors.border },
        pressed && styles.categoryPressed,
      ]}
      onPress={() => handleCategoryPress(item.slug)}
      accessibilityLabel={`Browse ${item.name}`}
      accessibilityRole="button"
    >
      <Image
        source={
          item.image_url ? { uri: item.image_url } : categoryPlaceholderImage
        }
        style={[styles.categoryImage, { backgroundColor: colors.muted }]}
        contentFit="cover"
        transition={300}
        autoplay={false}
      />
      <View style={styles.categoryInfo}>
        <Text style={[styles.categoryName, { color: colors.text }]}>
          {item.name}
        </Text>
        <Text style={[styles.categoryCount, { color: colors.textSecondary }]}>
          Explore collection
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.icon} />
    </Pressable>
  );

  return (
    <StorefrontScreenShell
      edges={['top']}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      {/* Show offline banner when offline but have cached data */}
      {!isOnline && categories.length > 0 && (
        <OfflineNotice
          variant="banner"
          showRetry
          onRetry={() => refetch()}
          isRetrying={isRefetching}
          showCachedDataNotice
        />
      )}
      <FlatList
        data={categories}
        renderItem={renderCategory}
        keyExtractor={(item) => item.id}
        getItemLayout={getItemLayout}
        removeClippedSubviews={Platform.OS === 'android'}
        maxToRenderPerBatch={10}
        windowSize={5}
        initialNumToRender={8}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        showsVerticalScrollIndicator={false}
      />
    </StorefrontScreenShell>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
  },
  errorTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    marginTop: SPACING.md,
    marginBottom: SPACING.xs,
    textAlign: 'center',
  },
  errorSubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: SPACING.lg,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl,
    borderRadius: RADIUS.lg,
  },
  retryButtonText: {
    color: BRAND.onPrimary,
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  listContent: {
    padding: SPACING.md,
  },
  categoryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
  },
  categoryPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  categoryImage: {
    width: 64,
    height: 64,
    borderRadius: RADIUS.lg,
  },
  categoryInfo: {
    flex: 1,
    marginLeft: 16,
  },
  categoryName: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    marginBottom: 4,
  },
  categoryCount: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  separator: {
    height: 12,
  },
});
