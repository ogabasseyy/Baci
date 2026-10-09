import Ionicons from '@react-native-vector-icons/ionicons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StatusBar,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CostPriceEditorModal } from '@/components/transactions/CostPriceEditorModal';
import { TransactionListState } from '@/components/transactions/TransactionListState';
import { TransactionOrderCard } from '@/components/transactions/TransactionOrderCard';
import { TransactionsSummary } from '@/components/transactions/TransactionsSummary';
import { styles } from '@/components/transactions/transactions.styles';
import { useAnalyticsOverview } from '@/hooks/useAnalyticsOverview';
import { useCurrency } from '@/hooks/useCurrency';
import { useCurrentDate } from '@/hooks/useCurrentDate';
import { useDebounce } from '@/hooks/useDebounce';
import { useTheme } from '@/hooks/useTheme';
import { useTransactionCostPriceEditor } from '@/hooks/useTransactionCostPriceEditor';
import { useTransactionReview } from '@/hooks/useTransactionReview';
import { useTransactionsSummary } from '@/hooks/useTransactionsSummary';
import { resolveAnalyticsDateRange } from '@/lib/analytics-period';
import { parseTransactionReviewRangeParams } from '@/lib/parse-transaction-review-range-params';
import {
  filterOrdersForTransactionTab,
  filterTransactionOrders,
  getSupplierOptionsFromOrders,
} from '@/lib/transaction-review';

type TransactionReviewTab = 'missing-costs' | 'paid';

export default function TransactionsScreen() {
  const { colors, isDark } = useTheme();
  const { format: formatCurrency, symbol: currencySymbol } = useCurrency();
  const router = useRouter();
  const params = useLocalSearchParams<{
    endDate?: string | string[];
    startDate?: string | string[];
  }>();
  const range = parseTransactionReviewRangeParams(
    params.startDate,
    params.endDate
  );
  const currentMonthAnchor = useCurrentDate();
  const profitRange = resolveAnalyticsDateRange(
    'this_month',
    currentMonthAnchor.getFullYear(),
    currentMonthAnchor,
    currentMonthAnchor,
    currentMonthAnchor
  );
  const { data: profitAnalytics, error: profitError } =
    useAnalyticsOverview(profitRange);
  const [activeTab, setActiveTab] = useState<TransactionReviewTab>('paid');
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebounce(searchQuery, 250);
  const searching = Boolean(debouncedSearchQuery.trim());
  const {
    data: orders = [],
    isLoading,
    isRefetching,
    error,
    refetch,
    searchTruncated,
  } = useTransactionReview(searching ? undefined : range, {
    search: searching ? debouncedSearchQuery : undefined,
    tab: activeTab,
  });
  const { refetchMonthlyCount, summary } = useTransactionsSummary(
    range,
    currentMonthAnchor
  );
  const isRetrying = isLoading || isRefetching;
  const editor = useTransactionCostPriceEditor({
    currencySymbol,
    formatCurrency,
  });

  const estimatedProfitThisMonthLabel = profitError
    ? 'Unavailable'
    : profitAnalytics
      ? formatCurrency(profitAnalytics.summary.profit.value)
      : '--';

  const tabFilteredOrders = filterOrdersForTransactionTab(orders, activeTab);
  const visibleOrders = filterTransactionOrders(
    tabFilteredOrders,
    searching ? debouncedSearchQuery : searchQuery
  );
  const unmatchedItemCount = visibleOrders.reduce(
    (count, order) =>
      count +
      order.items.filter(
        (item) => !item.productId && item.productMatchStatus !== 'custom'
      ).length,
    0
  );
  const unmatchedItemLabel =
    unmatchedItemCount === 1
      ? 'Review 1 unmatched transaction item'
      : `Review ${unmatchedItemCount} unmatched transaction items`;
  const supplierOptions = getSupplierOptionsFromOrders(orders);

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Transactions',
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerShadowVisible: false,
        }}
      />
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={['bottom']}
      >
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

        <ScrollView contentContainerStyle={styles.content}>
          <TransactionsSummary
            activeTab={activeTab}
            colors={colors}
            estimatedProfitLabel={estimatedProfitThisMonthLabel}
            onTabChange={setActiveTab}
            summary={summary}
          />

          <View
            style={[
              styles.searchContainer,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Ionicons
              name="search-outline"
              size={18}
              color={colors.textMuted}
            />
            <TextInput
              accessibilityLabel="Search transactions"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setSearchQuery}
              placeholder="Search IMEI, serial, customer, order, supplier"
              placeholderTextColor={colors.textMuted}
              returnKeyType="search"
              style={[styles.searchInput, { color: colors.text }]}
              value={searchQuery}
            />
            {searchQuery ? (
              <Pressable
                accessibilityLabel="Clear transaction search"
                accessibilityRole="button"
                onPress={() => setSearchQuery('')}
                hitSlop={8}
              >
                <Ionicons
                  name="close-circle"
                  size={18}
                  color={colors.textMuted}
                />
              </Pressable>
            ) : null}
          </View>

          {unmatchedItemCount > 0 ? (
            <Pressable
              accessibilityLabel={unmatchedItemLabel}
              accessibilityRole="button"
              onPress={() => router.push('/(admin)/transaction-reconciliation')}
              style={({ pressed }) => [
                styles.reconciliationButton,
                {
                  backgroundColor: `${colors.primary}12`,
                  borderColor: `${colors.primary}30`,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              <View style={styles.reconciliationButtonIcon}>
                <Ionicons
                  name="git-compare-outline"
                  size={18}
                  color={colors.primary}
                />
              </View>
              <View style={styles.flexOne}>
                <Text
                  style={[
                    styles.reconciliationButtonTitle,
                    { color: colors.text },
                  ]}
                >
                  {unmatchedItemLabel}
                </Text>
                <Text
                  style={[
                    styles.reconciliationButtonSubtitle,
                    { color: colors.textSecondary },
                  ]}
                >
                  Link custom sold rows back to catalog products.
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.textMuted}
              />
            </Pressable>
          ) : null}

          <TransactionListState
            colors={colors}
            error={error}
            hasOrders={orders.length > 0}
            isLoading={isLoading}
            isRetrying={isRetrying}
            onRetry={() => {
              void refetch();
              void refetchMonthlyCount();
            }}
            searching={searching}
            searchTruncated={searchTruncated}
            visibleOrderCount={visibleOrders.length}
          />

          {error && orders.length > 0 ? (
            <View
              style={[
                styles.heroCard,
                {
                  backgroundColor: `${colors.warning}12`,
                  borderColor: `${colors.warning}30`,
                },
              ]}
            >
              <Text
                style={[styles.heroSubtitle, { color: colors.textSecondary }]}
              >
                Unable to refresh transactions. Showing the last loaded data.
              </Text>
            </View>
          ) : null}

          {visibleOrders.map((order) => (
            <TransactionOrderCard
              key={order.id}
              colors={colors}
              formatCurrency={formatCurrency}
              onOpenEditor={editor.handleOpenEditor}
              order={order}
            />
          ))}
        </ScrollView>

        <CostPriceEditorModal
          colors={colors}
          costPriceInput={editor.costPriceInput}
          currencySymbol={currencySymbol}
          dateInput={editor.dateInput}
          onChangeCostPrice={editor.handleChangeCostPrice}
          onChangeDate={editor.setDateInput}
          onChangeSupplier={editor.handleChangeSupplier}
          onChangeUpdateProductDefault={editor.setUpdateProductDefault}
          onClose={editor.handleCloseEditor}
          onSave={editor.handleSave}
          pending={editor.pending}
          saveError={editor.saveError}
          selectedItem={editor.selectedItem}
          supplierOptions={supplierOptions}
          supplierInput={editor.supplierInput}
          updateProductDefault={editor.updateProductDefault}
          visible={Boolean(editor.selectedItem)}
        />
      </SafeAreaView>
    </>
  );
}
