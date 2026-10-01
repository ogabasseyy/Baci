import Ionicons from '@react-native-vector-icons/ionicons';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { OfflineNotice } from '@/components/OfflineNotice';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND, RADIUS, SHADOWS, SPACING } from '@/constants/Colors';
import { SAVED_LIST_BOTTOM_PADDING } from '@/constants/saved-list-layout';
import { useNetworkState } from '@/hooks/use-network-state';
import { useStorefrontInsets } from '@/hooks/use-storefront-insets';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { createSafeBoundedImageSource } from '@/lib/safe-bounded-image-source';
import { useSavedStore } from '@/stores/saved-store';

const handleProductPress = (slug: string): void => {
  // M12 FIX: Guard navigation - only navigate if slug is truthy
  if (!slug) return;
  router.push(`/product/${slug}`);
};

export default function SavedTabScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { items, removeItem } = useSavedStore(
    useShallow((s) => ({ items: s.items, removeItem: s.removeItem }))
  );
  const { isOnline, refresh } = useNetworkState();
  const { getListContentStyle } = useStorefrontInsets();

  const handleRemove = (productId: string) => {
    removeItem(productId);
  };

  if (items.length === 0) {
    return (
      <StorefrontScreenShell
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={['top']}
      >
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Saved Items
          </Text>
        </View>
        {/* Show offline notice when offline with empty state */}
        {!isOnline && (
          <OfflineNotice
            variant="banner"
            showRetry
            onRetry={refresh}
            message="You're offline. Your saved items are stored locally."
          />
        )}
        <View style={styles.emptyContainer}>
          <View
            style={[
              styles.emptyIconContainer,
              { backgroundColor: colors.card },
            ]}
          >
            <Ionicons
              name="heart-outline"
              size={48}
              color={colors.textSecondary}
            />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            No saved items yet
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            Tap the heart icon on products you love to save them here
          </Text>
          <Pressable
            style={[
              styles.browseButton,
              { backgroundColor: BRAND.primary },
              !isOnline && styles.buttonDisabled,
            ]}
            onPress={() => router.push('/')}
            disabled={!isOnline}
            accessibilityRole="button"
            accessibilityLabel="Browse products"
          >
            <Text style={styles.browseButtonText}>Browse Products</Text>
          </Pressable>
          {!isOnline && (
            <Text style={[styles.offlineHint, { color: colors.textSecondary }]}>
              Connect to browse products
            </Text>
          )}
        </View>
      </StorefrontScreenShell>
    );
  }

  return (
    <StorefrontScreenShell
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top']}
    >
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Saved Items
        </Text>
        <Text style={[styles.headerCount, { color: colors.textSecondary }]}>
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </Text>
      </View>

      {/* Show offline notice when offline but have saved items */}
      {!isOnline && (
        <OfflineNotice
          variant="banner"
          showRetry
          onRetry={refresh}
          message="You're offline. Viewing locally saved items."
        />
      )}

      <FlashList
        data={items}
        keyExtractor={(item) => item.id}
        style={styles.scrollView}
        contentContainerStyle={getListContentStyle({
          gap: SPACING.md,
          includeBottomInset: false,
          padding: SPACING.lg,
          paddingBottom: SAVED_LIST_BOTTOM_PADDING,
        })}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <Pressable
            style={[styles.productCard, { backgroundColor: colors.card }]}
            onPress={() => handleProductPress(item.slug)}
            accessibilityRole="button"
            accessibilityLabel={`View ${item.name}`}
          >
            <Image
              source={createSafeBoundedImageSource({
                fit: 'cover',
                height: 80,
                uri: item.image,
                width: 80,
              })}
              style={styles.productImage}
              contentFit="cover"
              autoplay={false}
            />
            <View style={styles.productInfo}>
              <Text
                style={[styles.productName, { color: colors.text }]}
                numberOfLines={2}
              >
                {item.name}
              </Text>
              <Text style={[styles.productPrice, { color: BRAND.primary }]}>
                {formatNgnCurrency(item.price ?? 0)}
              </Text>
              {!isOnline && (
                <Text
                  style={[
                    styles.offlineIndicator,
                    { color: colors.textSecondary },
                  ]}
                >
                  Tap to view when online
                </Text>
              )}
            </View>
            <Pressable
              style={styles.removeButton}
              onPress={() => handleRemove(item.product_id)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item.name} from saved items`}
            >
              <Ionicons name="heart" size={24} color={BRAND.primary} />
            </Pressable>
          </Pressable>
        )}
      />
    </StorefrontScreenShell>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  headerTitle: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
  },
  headerCount: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
  },
  emptyIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    marginBottom: SPACING.sm,
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: SPACING.xl,
  },
  browseButton: {
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.lg,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  browseButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  offlineHint: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: SPACING.sm,
  },
  offlineIndicator: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  scrollView: {
    flex: 1,
  },
  productCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    borderRadius: RADIUS.xl,
    ...SHADOWS.sm,
  },
  productImage: {
    width: 80,
    height: 80,
    borderRadius: RADIUS.lg,
    backgroundColor: '#F3F4F6',
  },
  productInfo: {
    flex: 1,
    marginLeft: SPACING.md,
  },
  productName: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 4,
    lineHeight: 20,
  },
  productPrice: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  removeButton: {
    padding: SPACING.sm,
  },
});
