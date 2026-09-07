import Ionicons from '@react-native-vector-icons/ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import {
  BranchSwitcher,
  InsightCard,
  ProgressCard,
  QuickActionButton,
  RevenueChart,
  StatCard,
  WelcomeHeader,
} from '@/components/dashboard';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/constants/theme';
import { useAdminTabScrollToTop } from '@/hooks/useAdminTabScrollToTop';
import { type TimePeriod, useDashboardStats } from '@/hooks/useDashboardStats';
import { useMerchant } from '@/hooks/useMerchant';
import { useOrders } from '@/hooks/useOrders';
import { useSettingsStore } from '@/hooks/useSettingsStore';
import { useStoreReadiness } from '@/hooks/useStoreReadiness';
import { useTheme } from '@/hooks/useTheme';
import { pickAndUploadFavicon } from '@/lib/upload/pickAndUploadFavicon';

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

const PERIOD_OPTIONS: { value: TimePeriod; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Last 7 Days' },
  { value: 'month', label: 'This Month' },
  { value: 'all', label: 'All Time' },
];

function getTimeOfDay(): 'morning' | 'afternoon' | 'evening' {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function formatMetric(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return value.toString();
}

export default function HomeScreen() {
  const scrollRef = useAdminTabScrollToTop<ScrollView>('index');
  if (__DEV__) {
    console.log('[HomeScreen] Rendering');
  }
  const { colors, shadows } = useTheme();
  const { merchant, storeUrl, isLive, primaryDomain } = useMerchant();
  const [period, setPeriod] = useState<TimePeriod>('week');
  const [showPeriodPicker, setShowPeriodPicker] = useState(false);
  const { stats, revenueData, refetch } = useDashboardStats(period);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  };
  const queryClient = useQueryClient();
  const { readiness, isLoading: isReadinessLoading } = useStoreReadiness();
  const { data: recentOrders, isLoading: isOrdersLoading } = useOrders();

  const [_, setIsUploadingFavicon] = useState(false);

  const handleAvatarPress = () =>
    pickAndUploadFavicon(setIsUploadingFavicon, queryClient);

  const currentPeriodLabel =
    PERIOD_OPTIONS.find((p) => p.value === period)?.label ?? 'Last 7 Days';

  // Get the first name for greeting
  const firstName = merchant?.business_name?.split(' ')[0] ?? 'there';

  const currencySymbol = getCurrencySymbol(merchant?.payout_currency);

  const formatCurrency = (amount: number) => {
    if (amount >= 1000000) {
      return `${currencySymbol}${(amount / 1000000).toFixed(1)}M`;
    }
    return `${currencySymbol}${amount.toLocaleString()}`;
  };

  const getPeriodLabel = () => {
    switch (period) {
      case 'today':
        return 'yesterday';
      case 'week':
        return 'last week';
      case 'month':
        return 'last month';
      default:
        return '';
    }
  };

  const getRevenueInsightText = (): string | undefined => {
    if (period === 'all' || !stats) return undefined;

    const current = stats.revenue;
    const previous = stats.previousPeriodRevenue;

    if (previous === 0 && current === 0) {
      return 'No revenue data to compare';
    }

    if (previous === 0) {
      return `New revenue this ${period === 'today' ? 'day' : period}!`;
    }

    const percentChange = ((current - previous) / previous) * 100;
    const absChange = Math.abs(percentChange).toFixed(0);

    if (percentChange > 0) {
      return `Revenue is up ${absChange}% vs ${getPeriodLabel()}`;
    } else if (percentChange < 0) {
      return `Revenue is down ${absChange}% vs ${getPeriodLabel()}`;
    } else {
      return `Revenue unchanged from ${getPeriodLabel()}`;
    }
  };

  const getRevenueInsightTrend = (): 'up' | 'down' | 'neutral' => {
    if (period === 'all' || !stats) return 'neutral';

    const current = stats.revenue;
    const previous = stats.previousPeriodRevenue;

    if (previous === 0 || current === previous) return 'neutral';
    return current > previous ? 'up' : 'down';
  };

  // Dashboard UI

  // Zustand selector: subscribe to the derived boolean so the component
  // re-renders when the underlying insightDismissedDate changes.
  const { setInsightDismissed, showInsight } = useSettingsStore(
    useShallow((s) => ({
      setInsightDismissed: s.setInsightDismissed,
      showInsight: s.shouldShowInsight(),
    }))
  );

  const handleDismissInsight = () => {
    setInsightDismissed(true);
  };

  const handleShareStore = async () => {
    try {
      if (!storeUrl) return;

      const url = `https://${storeUrl}`;
      await Share.share({
        message: `Check out my store! ${url}`,
        url: url, // iOS
        title: merchant?.business_name ?? 'My Store', // Android
      });
    } catch (error) {
      console.error('Error sharing store:', error);
    }
  };

  const handleBuyDomain = () => {
    router.push('/(admin)/domains');
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={['top']}
    >
      <ScrollView
        ref={scrollRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={colors.gold}
            colors={[colors.gold]}
          />
        }
      >
        <WelcomeHeader
          storeUrl={storeUrl}
          avatarUrl={
            merchant?.favicon_png_192_url ?? merchant?.logo_url ?? undefined
          }
          isLive={isLive}
          notificationCount={0}
          onNotificationPress={() => router.push('/(admin)/notifications')}
          onAvatarPress={handleAvatarPress}
        />

        <BranchSwitcher />

        <View style={styles.actionButtonsRow}>
          <Pressable
            style={[
              styles.actionCard,
              { backgroundColor: colors.card },
              shadows.sm,
            ]}
            onPress={handleBuyDomain}
          >
            <Ionicons name="globe-outline" size={20} color={colors.primary} />
            <Text style={[styles.actionCardText, { color: colors.text }]}>
              {!primaryDomain || primaryDomain.domain_type === 'subdomain'
                ? 'Get Domain'
                : 'Manage Domain'}
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.actionCard,
              { backgroundColor: colors.card },
              shadows.sm,
            ]}
            onPress={handleShareStore}
          >
            <Ionicons name="share-outline" size={20} color={colors.gold} />
            <Text style={[styles.actionCardText, { color: colors.text }]}>
              Share link
            </Text>
          </Pressable>
        </View>

        {/* Setup Checklist - Shown when store is not ready */}
        {!isReadinessLoading && readiness && !readiness.isReady && (
          <View style={styles.section}>
            <ProgressCard
              title="Finish Setup"
              subtitle="Complete your store setup to start selling"
              progress={readiness.overallProgress}
              onPress={() => router.push('/(admin)/setup-checklist')}
            />
          </View>
        )}

        {/* Insight Card - Shown when store IS ready (or if setup is ignored) */}
        {showInsight && stats && (readiness?.isReady || false) && (
          <View style={styles.section}>
            <InsightCard
              title={`Good ${getTimeOfDay()}, ${firstName}`}
              message={
                stats.newCustomers > 0
                  ? `You got ${stats.newCustomers} new customer${stats.newCustomers !== 1 ? 's' : ''} ${period === 'today' ? 'today' : period === 'week' ? 'this week' : 'this month'}! ${stats.pendingOrders > 0 ? `You have ${stats.pendingOrders} pending order${stats.pendingOrders !== 1 ? 's' : ''} to process.` : ''}`
                  : stats.pendingOrders > 0
                    ? `You have ${stats.pendingOrders} pending order${stats.pendingOrders !== 1 ? 's' : ''} to process.`
                    : stats.visits > 0
                      ? `Your store had ${stats.visits} visit${stats.visits !== 1 ? 's' : ''} ${period === 'today' ? 'today' : period === 'week' ? 'this week' : 'this month'}. Consider running a promotion!`
                      : 'Welcome back! Share your store link to get more customers.'
              }
              icon="sparkles"
              onPress={() => router.push('/(admin)/analytics')}
              onDismiss={handleDismissInsight}
            />
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.statsGrid}>
            <StatCard
              label="Orders"
              value={formatMetric(stats?.orders ?? 0)}
              icon="receipt-outline"
              iconColor={colors.primary}
            />
            <StatCard
              label="Items"
              value={formatMetric(stats?.totalItems ?? 0)}
              icon="cube-outline"
              iconColor={colors.gold}
            />
            <StatCard
              // fetchDashboardStats intentionally leaves visitsQuery and
              // customersQuery unscoped, so these totals stay cross-branch.
              label="Visits"
              value={formatMetric(stats?.visits ?? 0)}
              icon="globe-outline"
              iconColor={colors.info}
            />
            <StatCard
              // fetchDashboardStats intentionally leaves visitsQuery and
              // customersQuery unscoped, so these totals stay cross-branch.
              label="New"
              value={formatMetric(stats?.newCustomers ?? 0)}
              icon="people-outline"
              iconColor={colors.success}
            />
          </View>
        </View>

        <View style={[styles.section, { zIndex: 10 }]}>
          <View style={{ position: 'relative' }}>
            <RevenueChart
              data={revenueData.length > 0 ? revenueData : []}
              title="Revenue Overview"
              period={currentPeriodLabel}
              totalRevenue={formatCurrency(stats?.revenue ?? 0)}
              onPeriodPress={() => setShowPeriodPicker(!showPeriodPicker)}
              insightText={getRevenueInsightText()}
              insightTrend={getRevenueInsightTrend()}
            />

            {showPeriodPicker && (
              <View style={styles.periodDropdownWrapper}>
                <View
                  style={[
                    styles.periodDropdown,
                    { backgroundColor: colors.card },
                    shadows.md,
                  ]}
                >
                  {PERIOD_OPTIONS.map((option) => (
                    <Pressable
                      key={option.value}
                      style={[
                        styles.periodOption,
                        period === option.value && {
                          backgroundColor: colors.goldLight,
                        },
                      ]}
                      onPress={() => {
                        setPeriod(option.value);
                        setShowPeriodPicker(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.periodOptionText,
                          {
                            color:
                              period === option.value
                                ? colors.gold
                                : colors.text,
                          },
                        ]}
                      >
                        {option.label}
                      </Text>
                      {period === option.value && (
                        <Ionicons
                          name="checkmark"
                          size={16}
                          color={colors.gold}
                        />
                      )}
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Quick Actions
          </Text>
          <View style={styles.actionsGrid}>
            <QuickActionButton
              icon="add-circle-outline"
              label="Add Order"
              iconColor={colors.primary}
              backgroundColor={colors.primaryLight}
              onPress={() => router.push('/(admin)/order/new')}
            />
            <QuickActionButton
              icon="chatbubbles-outline"
              label="Negotiations"
              iconColor={colors.gold}
              backgroundColor={colors.goldLight}
              iconSize={21}
              onPress={() => router.push('/(admin)/negotiations')}
            />
            <QuickActionButton
              icon="cube-outline"
              label="Add Product"
              iconColor={colors.orange}
              backgroundColor={colors.orangeLight}
              onPress={() => router.push('/(admin)/product/new')}
            />
            <QuickActionButton
              icon="newspaper-outline"
              label="Blog Manager"
              iconColor={colors.success}
              backgroundColor={colors.successLight}
              onPress={() => router.push('/(admin)/blog')}
            />
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Recent Transactions
            </Text>
            <Pressable onPress={() => router.push('/(admin)/(tabs)/orders')}>
              <Text
                style={{
                  color: colors.primary,
                  fontFamily: TYPOGRAPHY.fontFamily.semiBold,
                }}
              >
                View All
              </Text>
            </Pressable>
          </View>

          <View
            style={[
              styles.topProductsCard,
              { backgroundColor: colors.card },
              shadows.sm,
            ]}
          >
            {isOrdersLoading ? (
              <View style={{ padding: 20, alignItems: 'center' }}>
                <Text style={{ color: colors.textSecondary }}>
                  Loading transactions…
                </Text>
              </View>
            ) : (
              recentOrders?.pages[0]?.orders.slice(0, 5).map((order, index) => {
                const getStatusConfig = (status: string) => {
                  switch (status) {
                    case 'delivered':
                      return {
                        icon: 'checkmark-circle' as const,
                        color: colors.success,
                        bg: `${colors.success}15`,
                      };
                    case 'shipped':
                      return {
                        icon: 'bicycle' as const,
                        color: colors.info,
                        bg: `${colors.info}15`,
                      };
                    case 'cancelled':
                      return {
                        icon: 'close-circle' as const,
                        color: colors.notification,
                        bg: `${colors.notification}15`,
                      };
                    case 'processing':
                      return {
                        icon: 'cube' as const,
                        color: colors.primary,
                        bg: `${colors.primary}15`,
                      };
                    default: // pending
                      return {
                        icon: 'time' as const,
                        color: colors.gold,
                        bg: `${colors.gold}15`,
                      };
                  }
                };

                const statusConfig = getStatusConfig(order.shipping_status);

                return (
                  <View key={`recent-${order.id}`}>
                    {index > 0 && (
                      <View
                        style={[
                          styles.productDivider,
                          { backgroundColor: colors.border },
                        ]}
                      />
                    )}
                    <Pressable
                      style={styles.productRow}
                      onPress={() => router.push(`/(admin)/order/${order.id}`)}
                    >
                      <View
                        style={[
                          styles.orderIcon,
                          { backgroundColor: statusConfig.bg },
                        ]}
                      >
                        <Ionicons
                          name={statusConfig.icon}
                          size={20}
                          color={statusConfig.color}
                        />
                      </View>
                      <View style={styles.productInfo}>
                        <Text
                          style={[styles.productName, { color: colors.text }]}
                          numberOfLines={1}
                        >
                          {order.items?.[0]?.name ||
                            `Order #${order.order_number}`}
                          {order.items && order.items.length > 1
                            ? ` + ${order.items.length - 1} more`
                            : ''}
                        </Text>
                        <Text
                          style={[
                            styles.productStats,
                            { color: colors.textSecondary },
                          ]}
                        >
                          {new Date(order.created_at).toLocaleDateString()} •{' '}
                          {order.customer_name}
                        </Text>
                      </View>
                      <Text
                        style={[styles.productRevenue, { color: colors.text }]}
                      >
                        {formatCurrency(order.total)}
                      </Text>
                    </Pressable>
                  </View>
                );
              })
            )}

            {(!recentOrders?.pages[0]?.orders ||
              recentOrders.pages[0].orders.length === 0) &&
              !isOrdersLoading && (
                <View style={{ padding: 20, alignItems: 'center' }}>
                  <Text style={{ color: colors.textSecondary }}>
                    No recent transactions
                  </Text>
                </View>
              )}
          </View>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: SPACING['3xl'],
  },
  section: {
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
    position: 'relative',
    zIndex: 10,
  },
  sectionTitle: {
    fontSize: TYPOGRAPHY.size.md,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
  },
  periodSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    gap: SPACING.xs,
  },
  periodDropdownWrapper: {
    position: 'absolute',
    top: 60,
    left: SPACING.lg,
    zIndex: 100,
  },
  periodDropdown: {
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    minWidth: 140,
  },
  periodOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  periodOptionText: {
    fontSize: TYPOGRAPHY.size.md,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  bottomSpacer: {
    height: 20,
  },
  topProductsCard: {
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginTop: SPACING.sm,
  },
  productDivider: {
    height: 1,
    marginVertical: SPACING.md,
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  productRank: {
    width: 28,
    height: 28,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  productRankText: {
    fontSize: TYPOGRAPHY.size.xs,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
  },
  productImage: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.md,
  },
  productImagePlaceholder: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderIcon: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  productInfo: {
    flex: 1,
  },
  productName: {
    fontSize: TYPOGRAPHY.size.sm,
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
  },
  productStats: {
    fontSize: TYPOGRAPHY.size.xs,
    fontFamily: TYPOGRAPHY.fontFamily.regular,
    marginTop: 2,
  },
  productRevenue: {
    fontSize: TYPOGRAPHY.size.md,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.lg,
    gap: SPACING.md,
    marginBottom: SPACING.md,
  },
  storeInfo: {
    marginLeft: SPACING.md,
  },
  domainCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.md,
  },
  actionCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    gap: SPACING.sm,
  },
  actionCardText: {
    fontSize: TYPOGRAPHY.size.sm,
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
  },
});
