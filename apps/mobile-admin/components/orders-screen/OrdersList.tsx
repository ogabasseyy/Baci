import Ionicons from '@react-native-vector-icons/ionicons';
import { FlashList, type FlashListProps } from '@shopify/flash-list';
import type { ComponentType, RefObject } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/constants/theme';
import type { OrdersViewState } from '@/lib/orders-view-state';
import type {
  OrdersListOnScroll,
  OrdersListRenderItem,
  OrdersListRow,
  ThemeColors,
} from './types';

const SECTION_ROW_GAP = SPACING.lg;

const AnimatedFlashList = Animated.createAnimatedComponent(
  FlashList as ComponentType<FlashListProps<OrdersListRow>>
);

interface OrdersListProps {
  colors: ThemeColors;
  data: OrdersListRow[];
  isRefreshing: boolean;
  isFetchingNextPage: boolean;
  listViewState: OrdersViewState;
  renderItem: OrdersListRenderItem;
  onScroll?: OrdersListOnScroll;
  scrollRef?: RefObject<{
    scrollToOffset: (options: { offset: number; animated?: boolean }) => void;
  } | null>;
  onRefresh: () => void;
  onEndReached: () => void;
}

export function OrdersList({
  colors,
  data,
  isRefreshing,
  isFetchingNextPage,
  listViewState,
  renderItem,
  onScroll,
  scrollRef,
  onRefresh,
  onEndReached,
}: OrdersListProps) {
  return (
    <AnimatedFlashList
      ref={scrollRef as never}
      data={data}
      renderItem={renderItem}
      getItemType={(item) => item.type}
      ItemSeparatorComponent={() => (
        <View testID="orders-list-separator" style={styles.separator} />
      )}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.listContent}
      onScroll={onScroll}
      scrollEventThrottle={16}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={onRefresh}
          tintColor={colors.gold}
          colors={[colors.gold]}
        />
      }
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      ListFooterComponent={
        isFetchingNextPage ? <OrdersListFooter colors={colors} /> : null
      }
      ListEmptyComponent={
        <OrdersListEmpty
          colors={colors}
          listViewState={listViewState}
          onRetry={onRefresh}
        />
      }
      showsVerticalScrollIndicator={false}
    />
  );
}

function OrdersListFooter({ colors }: { colors: ThemeColors }) {
  return (
    <View style={styles.footerLoader}>
      <ActivityIndicator color={colors.gold} />
    </View>
  );
}

function OrdersListEmpty({
  colors,
  listViewState,
  onRetry,
}: {
  colors: ThemeColors;
  listViewState: OrdersViewState;
  onRetry: () => void;
}) {
  if (listViewState.status === 'error') {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="alert-circle-outline" size={56} color={colors.error} />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>
          {listViewState.title}
        </Text>
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          {listViewState.message}
        </Text>
        <Pressable
          style={[styles.emptyAction, { backgroundColor: colors.primary }]}
          onPress={onRetry}
          accessibilityLabel="Retry"
          accessibilityRole="button"
          accessibilityHint="Attempt to reload orders from the server"
        >
          <Text
            style={[styles.emptyActionText, { color: colors.textOnPrimary }]}
          >
            Try Again
          </Text>
        </Pressable>
      </View>
    );
  }

  if (listViewState.status === 'empty') {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="receipt-outline" size={56} color={colors.textMuted} />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>
          No orders found
        </Text>
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          Orders will appear here when customers place them
        </Text>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  separator: { height: SECTION_ROW_GAP },
  listContent: {
    padding: SPACING.lg,
    paddingTop: SECTION_ROW_GAP,
    paddingBottom: 80,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: SPACING.sm,
  },
  emptyTitle: {
    fontSize: TYPOGRAPHY.size.lg,
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
    marginTop: SPACING.md,
  },
  emptyText: {
    fontSize: TYPOGRAPHY.size.sm,
    fontFamily: TYPOGRAPHY.fontFamily.regular,
    textAlign: 'center',
  },
  emptyAction: {
    marginTop: SPACING.md,
    minWidth: 140,
    minHeight: 44,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
  },
  emptyActionText: {
    fontSize: TYPOGRAPHY.size.sm,
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
  },
  footerLoader: { paddingVertical: SPACING.lg, alignItems: 'center' },
});
