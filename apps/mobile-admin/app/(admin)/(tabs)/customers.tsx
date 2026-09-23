/**
 * Customers Screen - Customer Management
 * View customer list and details with real-time data
 */

import { getCustomerDisplayName } from '@baci/shared';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { ListRenderItemInfo } from '@shopify/flash-list';
import { FlashList } from '@shopify/flash-list';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import React, { useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FollowUpQueueList } from '@/components/customers/FollowUpQueueList';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/constants/theme';
import { useAdminTabScrollToTop } from '@/hooks/useAdminTabScrollToTop';
import {
  type Customer,
  useCustomerStats,
  useCustomers,
} from '@/hooks/useCustomers';
import { useDebounce } from '@/hooks/useDebounce';
import type { FailedOrder } from '@/hooks/useFailedOrders';
import { useMerchant } from '@/hooks/useMerchant';
import { useTheme } from '@/hooks/useTheme';

// Helper to get currency symbol from merchant's payout_currency
const getCurrencySymbol = (currencyCode: string | null | undefined) => {
  const symbols: Record<string, string> = {
    NGN: '\u20A6',
    USD: '$',
    GBP: '\u00A3',
    EUR: '\u20AC',
  };
  return symbols[currencyCode || 'NGN'] || '\u20A6';
};

// Helper functions moved outside component to prevent recreation
const formatCurrency = (amount: number, symbol: string = '\u20A6') => {
  if (amount >= 1000000) {
    return `${symbol}${(amount / 1000000).toFixed(1)} M`;
  }
  if (amount >= 1000) {
    return `${symbol}${(amount / 1000).toFixed(0)} k`;
  }
  return `${symbol}${amount.toLocaleString()} `;
};

const getInitials = (name: string | null) => {
  if (!name) return '?';
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
};

const getDisplayName = (customer: Customer) => {
  return getCustomerDisplayName(customer);
};

const handleWhatsApp = (phone: string) => {
  const cleanPhone = phone.replace(/\D/g, '');
  Linking.openURL(`https://wa.me/${cleanPhone}`);
};

const handleCall = (phone: string) => {
  const cleanPhone = phone.replace(/[^\d+]/g, '');
  Linking.openURL(`tel:${cleanPhone}`);
};

const handleEmail = (email: string) => {
  Linking.openURL(`mailto:${email}`);
};

// Failed Order Item component
interface FailedOrderItemProps {
  item: FailedOrder;
  currencySymbol: string;
  onPress: (item: FailedOrder) => void;
}

function FailedOrderItem({
  item,
  currencySymbol,
  onPress,
}: FailedOrderItemProps) {
  const { colors, shadows } = useTheme();
  const STATUS_LABELS: Record<string, string> = {
    bnpl_pending: 'BNPL Drop-off',
    failed: 'Payment Failed',
    pending: 'Abandoned Transfer',
    expired: 'Payment Expired',
    unpaid: 'Checkout Drop-off',
  };

  const gatewayMessage =
    typeof item.gateway_response?.message === 'string' &&
    item.gateway_response.message.trim() !== ''
      ? item.gateway_response.message
      : null;
  const errorMessage =
    gatewayMessage ?? STATUS_LABELS[item.payment_status] ?? 'Payment Failed';

  const displayName = item.customer_name || 'Guest';
  const customerPhone = item.customer_phone?.trim() || null;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.customerCard,
        { backgroundColor: colors.card, minHeight: 56 },
        shadows.sm,
        pressed && { backgroundColor: colors.cardHover },
      ]}
      onPress={() => onPress(item)}
      accessibilityLabel={`Follow up: ${displayName}, ${item.customer_email}, ${formatCurrency(item.total, currencySymbol)}, ${errorMessage}`}
      accessibilityRole="button"
      accessibilityHint="View customer or order details"
    >
      <View style={[styles.avatar, { backgroundColor: colors.goldLight }]}>
        <Text style={[styles.avatarText, { color: colors.gold }]}>
          {getInitials(displayName)}
        </Text>
      </View>

      <View style={styles.customerInfo}>
        <Text
          style={[styles.customerName, { color: colors.text }]}
          numberOfLines={1}
        >
          {displayName}
        </Text>
        <Text
          style={[styles.customerEmail, { color: colors.textSecondary }]}
          numberOfLines={1}
        >
          {item.customer_email}
        </Text>

        <Text
          style={[
            styles.errorText,
            {
              color:
                item.payment_status === 'pending' ||
                item.payment_status === 'unpaid' ||
                item.payment_status === 'expired'
                  ? colors.warning
                  : colors.error,
            },
          ]}
          numberOfLines={1}
        >
          {formatCurrency(item.total, currencySymbol)} •{' '}
          {item.attempt_count > 1
            ? `${item.attempt_count} attempts`
            : errorMessage}
        </Text>
      </View>

      <View style={styles.actionRow}>
        {customerPhone ? (
          <>
            <Pressable
              style={[
                styles.miniActionButton,
                {
                  backgroundColor: colors.successLight,
                  minWidth: 44,
                  minHeight: 44,
                },
              ]}
              onPress={(e) => {
                e.stopPropagation();
                handleWhatsApp(customerPhone);
              }}
              accessibilityLabel={`Message ${displayName} on WhatsApp`}
              accessibilityRole="button"
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Ionicons name="logo-whatsapp" size={16} color={colors.success} />
            </Pressable>
            <Pressable
              style={[
                styles.miniActionButton,
                {
                  backgroundColor: colors.backgroundLight,
                  minWidth: 44,
                  minHeight: 44,
                },
              ]}
              onPress={(e) => {
                e.stopPropagation();
                handleCall(customerPhone);
              }}
              accessibilityLabel={`Call ${displayName}`}
              accessibilityRole="button"
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Ionicons name="call" size={16} color={colors.textSecondary} />
            </Pressable>
          </>
        ) : null}
        <Pressable
          style={[
            styles.miniActionButton,
            {
              backgroundColor: colors.primaryLight,
              minWidth: 44,
              minHeight: 44,
            },
          ]}
          onPress={(e) => {
            e.stopPropagation();
            handleEmail(item.customer_email);
          }}
          accessibilityLabel={`Email ${displayName}`}
          accessibilityRole="button"
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Ionicons name="mail" size={16} color={colors.primary} />
        </Pressable>
      </View>
    </Pressable>
  );
}

// Customer Item component
interface CustomerItemProps {
  item: Customer;
  currencySymbol: string;
  onPress: (id: string) => void;
}

function CustomerItem({ item, currencySymbol, onPress }: CustomerItemProps) {
  const { colors, shadows } = useTheme();
  const displayName = getDisplayName(item);
  const customerEmail = item.email ?? null;
  const customerEmailLabel = customerEmail ?? 'No email';
  const customerPhone = item.phone || null;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.customerCard,
        { backgroundColor: colors.card, minHeight: 56 },
        shadows.sm,
        pressed && { backgroundColor: colors.cardHover },
      ]}
      onPress={() => onPress(item.id)}
      accessibilityLabel={`${displayName}, ${customerEmailLabel}, ${item.total_orders} orders, spent ${formatCurrency(item.total_spent, currencySymbol)}`}
      accessibilityRole="button"
      accessibilityHint="View customer details"
    >
      <View style={[styles.avatar, { backgroundColor: colors.primaryLight }]}>
        <Text style={[styles.avatarText, { color: colors.primary }]}>
          {getInitials(displayName)}
        </Text>
      </View>

      <View style={styles.customerInfo}>
        <Text
          style={[styles.customerName, { color: colors.text }]}
          numberOfLines={1}
        >
          {displayName}
        </Text>
        <Text
          style={[styles.customerEmail, { color: colors.textSecondary }]}
          numberOfLines={1}
        >
          {customerEmailLabel}
        </Text>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Ionicons name="cart-outline" size={14} color={colors.textMuted} />
            <Text style={[styles.statText, { color: colors.textMuted }]}>
              {item.total_orders} orders
            </Text>
          </View>
          <Text style={[styles.statDot, { color: colors.textMuted }]}>•</Text>
          <View style={styles.stat}>
            <Text style={[styles.statText, { color: colors.success }]}>
              {formatCurrency(item.total_spent, currencySymbol)}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.actionRow}>
        {customerPhone ? (
          <>
            <Pressable
              style={[
                styles.miniActionButton,
                {
                  backgroundColor: colors.successLight,
                  minWidth: 44,
                  minHeight: 44,
                },
              ]}
              onPress={(e) => {
                e.stopPropagation();
                handleWhatsApp(customerPhone);
              }}
              accessibilityLabel={`Message ${displayName} on WhatsApp`}
              accessibilityRole="button"
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Ionicons name="logo-whatsapp" size={16} color={colors.success} />
            </Pressable>
            <Pressable
              style={[
                styles.miniActionButton,
                {
                  backgroundColor: colors.backgroundLight,
                  minWidth: 44,
                  minHeight: 44,
                },
              ]}
              onPress={(e) => {
                e.stopPropagation();
                handleCall(customerPhone);
              }}
              accessibilityLabel={`Call ${displayName}`}
              accessibilityRole="button"
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Ionicons name="call" size={16} color={colors.textSecondary} />
            </Pressable>
          </>
        ) : null}
        {customerEmail ? (
          <Pressable
            style={[
              styles.miniActionButton,
              {
                backgroundColor: colors.primaryLight,
                minWidth: 44,
                minHeight: 44,
              },
            ]}
            onPress={(e) => {
              e.stopPropagation();
              handleEmail(customerEmail);
            }}
            accessibilityLabel={`Email ${displayName}`}
            accessibilityRole="button"
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="mail" size={16} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

const customerKeyExtractor = (item: { id: string }) => item.id;

type CustomerTab = 'failed' | 'people' | 'companies' | 'all';

const CUSTOMER_TABS: Array<{
  hint: string;
  key: CustomerTab;
  label: string;
}> = [
  {
    hint: 'View customers with failed transactions',
    key: 'failed',
    label: 'Follow Up',
  },
  { hint: 'View individual customers', key: 'people', label: 'People' },
  { hint: 'View company customers', key: 'companies', label: 'Companies' },
  { hint: 'View all customers', key: 'all', label: 'All' },
];

export default function CustomersScreen() {
  const scrollRef = useAdminTabScrollToTop<{
    scrollToOffset: (options: { offset: number; animated?: boolean }) => void;
  }>('customers');
  const { colors, shadows, isDark } = useTheme();
  const { merchant } = useMerchant();
  const currencySymbol = getCurrencySymbol(merchant?.payout_currency);
  const router = useRouter();
  const [activeTab, setActiveTab] = React.useState<CustomerTab>('failed');
  const [followUpCount, setFollowUpCount] = React.useState(0);
  const [searchQuery, setSearchQuery] = React.useState('');
  const customerTypeFilter: 'individual' | 'company' | undefined =
    activeTab === 'people'
      ? 'individual'
      : activeTab === 'companies'
        ? 'company'
        : undefined;
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // Collapsible search bar animation
  // Using opacity and translateY for native driver support (better performance)
  // Held in state (lazy initializer) so render never reads a ref; the stable
  // Animated.Value is only mutated by Animated.timing inside the scroll handler.
  const [searchBarAnim] = React.useState(() => new Animated.Value(1));
  const lastScrollY = useRef(0);
  const isSearchVisible = useRef(true);

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const currentScrollY = event.nativeEvent.contentOffset.y;
    const diff = currentScrollY - lastScrollY.current;

    // Only trigger animation if scrolled more than 10px and not at top
    if (Math.abs(diff) > 10) {
      if (diff > 0 && isSearchVisible.current && currentScrollY > 50) {
        // Scrolling down - hide search bar
        isSearchVisible.current = false;
        Animated.timing(searchBarAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }).start();
      } else if (diff < 0 && !isSearchVisible.current) {
        // Scrolling up - show search bar
        isSearchVisible.current = true;
        Animated.timing(searchBarAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }).start();
      }
    }

    lastScrollY.current = currentScrollY;
  };

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useCustomers({
    search: debouncedSearchQuery,
    customerType: customerTypeFilter,
  });

  const { data: stats } = useCustomerStats();

  // Flatten pages into single array and filter by search
  const allCustomers = data?.pages.flatMap((page) => page.customers) ?? [];
  const customers = (() => {
    if (!searchQuery.trim()) return allCustomers;
    const q = searchQuery.toLowerCase();
    return allCustomers.filter(
      (c) =>
        getCustomerDisplayName(c).toLowerCase().includes(q) ||
        (c.email?.toLowerCase().includes(q) ?? false) ||
        (c.phone?.toLowerCase().includes(q) ?? false)
    );
  })();

  const handleLoadMore = () => {
    if (activeTab !== 'failed' && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  };

  // Navigation callbacks
  const handleCustomerPress = (id: string) => {
    router.push({ pathname: '/(admin)/customer/[id]', params: { id } });
  };

  const handleFailedOrderPress = (item: FailedOrder) => {
    if (item.customer_id) {
      router.push({
        pathname: '/(admin)/customer/[id]',
        params: { id: item.customer_id },
      });
    } else {
      router.push({
        pathname: '/(admin)/order/[id]',
        params: { id: item.id },
      });
    }
  };

  const renderCustomer = ({ item }: ListRenderItemInfo<Customer>) => (
    <CustomerItem
      item={item}
      currencySymbol={currencySymbol}
      onPress={handleCustomerPress}
    />
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top']}
    >
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Customers</Text>
      </View>
      {/* Collapsible Search Bar */}
      <Animated.View
        style={[
          styles.searchContainer,
          {
            opacity: searchBarAnim,
            transform: [
              {
                translateY: searchBarAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-60, 0],
                }),
              },
              {
                scaleY: searchBarAnim,
              },
            ],
          },
        ]}
      >
        <View style={[styles.searchBar, { backgroundColor: colors.card }]}>
          <Ionicons name="search" size={20} color={colors.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search customers..."
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Search customers"
            accessibilityRole="search"
            returnKeyType="search"
          />
          {searchQuery.length > 0 ? (
            <Pressable
              onPress={() => setSearchQuery('')}
              accessibilityLabel="Clear search"
              accessibilityRole="button"
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={{
                minWidth: 44,
                minHeight: 44,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <Ionicons
                name="close-circle"
                size={20}
                color={colors.textMuted}
              />
            </Pressable>
          ) : null}
        </View>
      </Animated.View>
      {/* Tabs */}
      <ScrollView
        accessibilityRole="tablist"
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabScroller}
        contentContainerStyle={styles.tabContainer}
      >
        {CUSTOMER_TABS.map((tab) => {
          const isSelected = activeTab === tab.key;
          const count = tab.key === 'failed' ? followUpCount : undefined;
          const label = count ? `${tab.label} (${count})` : tab.label;

          return (
            <Pressable
              accessibilityHint={tab.hint}
              accessibilityLabel={`${tab.label}${count ? `: ${count} customers` : ''}${isSelected ? ', currently selected' : ''}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: isSelected }}
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              style={[
                styles.tab,
                isSelected && {
                  backgroundColor: colors.gold,
                  borderColor: colors.gold,
                },
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  isSelected
                    ? {
                        color: isDark
                          ? colors.background
                          : colors.backgroundLight,
                      }
                    : { color: colors.textSecondary },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {activeTab !== 'failed' ? (
        <>
          {/* Stats Summary - Only for All Customers (global totals) */}
          {activeTab === 'all' ? (
            <View style={styles.summaryRow}>
              <View
                style={[
                  styles.summaryCard,
                  { backgroundColor: colors.card },
                  shadows.sm,
                ]}
              >
                <Text style={[styles.summaryValue, { color: colors.text }]}>
                  {stats?.total ?? 0}
                </Text>
                <Text
                  style={[styles.summaryLabel, { color: colors.textSecondary }]}
                >
                  Total
                </Text>
              </View>
              <View
                style={[
                  styles.summaryCard,
                  { backgroundColor: colors.card },
                  shadows.sm,
                ]}
              >
                <Text style={[styles.summaryValue, { color: colors.success }]}>
                  {stats?.newThisWeek ?? 0}
                </Text>
                <Text
                  style={[styles.summaryLabel, { color: colors.textSecondary }]}
                >
                  New
                </Text>
              </View>
              <View
                style={[
                  styles.summaryCard,
                  { backgroundColor: colors.card },
                  shadows.sm,
                ]}
              >
                <Text style={[styles.summaryValue, { color: colors.gold }]}>
                  {stats?.retentionRate ?? 0}%
                </Text>
                <Text
                  style={[styles.summaryLabel, { color: colors.textSecondary }]}
                >
                  Returning
                </Text>
              </View>
            </View>
          ) : null}

          {/* Customers List */}
          <FlashList
            ref={scrollRef as never}
            data={customers}
            renderItem={renderCustomer}
            keyExtractor={customerKeyExtractor}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={isLoading}
                onRefresh={refetch}
                tintColor={colors.gold}
                colors={[colors.gold]}
              />
            }
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.5}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            ListFooterComponent={
              isFetchingNextPage ? (
                <View style={styles.footerLoader}>
                  <ActivityIndicator color={colors.gold} />
                </View>
              ) : null
            }
            ListEmptyComponent={
              !isLoading ? (
                <View style={styles.emptyContainer}>
                  <Ionicons
                    name="people-outline"
                    size={56}
                    color={colors.textMuted}
                  />
                  <Text style={[styles.emptyTitle, { color: colors.text }]}>
                    No customers yet
                  </Text>
                  <Text
                    style={[styles.emptyText, { color: colors.textSecondary }]}
                  >
                    Customers will appear here after their first purchase
                  </Text>
                </View>
              ) : null
            }
            showsVerticalScrollIndicator={false}
          />
        </>
      ) : (
        <FollowUpQueueList
          currencySymbol={currencySymbol}
          onFollowUpCountChange={setFollowUpCount}
          onScroll={handleScroll}
          scrollRef={scrollRef}
          renderOrder={(item, failedOrderCurrencySymbol) => (
            <FailedOrderItem
              item={item}
              currencySymbol={failedOrderCurrencySymbol}
              onPress={handleFailedOrderPress}
            />
          )}
          searchQuery={searchQuery}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  title: {
    fontSize: TYPOGRAPHY.size['3xl'],
    fontFamily: TYPOGRAPHY.fontFamily.bold,
  },
  searchContainer: {
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.lg,
    gap: SPACING.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: TYPOGRAPHY.size.md,
    fontFamily: TYPOGRAPHY.fontFamily.regular,
    paddingVertical: SPACING.xs,
  },
  tabContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    gap: SPACING.sm,
  },
  tabScroller: {
    flexGrow: 0,
    maxHeight: 44,
    marginBottom: SPACING.md,
  },
  tab: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    minHeight: 32,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabText: {
    fontSize: TYPOGRAPHY.size.sm,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
  },
  summaryRow: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
    gap: SPACING.sm,
  },
  summaryCard: {
    flex: 1,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: TYPOGRAPHY.size.lg,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
  },
  summaryLabel: {
    fontSize: TYPOGRAPHY.size.xs,
    fontFamily: TYPOGRAPHY.fontFamily.regular,
    marginTop: 2,
  },
  listContent: {
    padding: SPACING.lg,
    paddingTop: 0,
    gap: SPACING.md,
  },
  customerCard: {
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
  },
  avatarText: {
    fontSize: TYPOGRAPHY.size.md,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
  },
  customerInfo: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  customerName: {
    fontSize: TYPOGRAPHY.size.md,
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
  },
  customerEmail: {
    fontSize: TYPOGRAPHY.size.xs,
    fontFamily: TYPOGRAPHY.fontFamily.regular,
    marginBottom: 4,
  },
  errorText: {
    fontSize: TYPOGRAPHY.size.xs,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statText: {
    fontSize: TYPOGRAPHY.size.xs,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
  },
  statDot: {
    fontSize: TYPOGRAPHY.size.xs,
  },
  rightSection: {
    alignItems: 'flex-end',
    gap: 4,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  miniActionButton: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lastOrder: {
    fontSize: TYPOGRAPHY.size.xs,
    fontFamily: TYPOGRAPHY.fontFamily.regular,
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
  footerLoader: {
    paddingVertical: SPACING.lg,
    alignItems: 'center',
  },
});
