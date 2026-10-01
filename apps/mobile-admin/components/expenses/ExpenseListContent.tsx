import Ionicons from '@react-native-vector-icons/ionicons';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StatusBar, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ExpenseFilterBar } from '@/components/expenses/ExpenseFilterBar';
import { ExpenseFiltersSheet } from '@/components/expenses/ExpenseFiltersSheet';
import { ExpenseListItem } from '@/components/expenses/ExpenseListItem';
import { ExpenseListSectionHeader } from '@/components/expenses/ExpenseListSectionHeader';
import { ExpenseListSummary } from '@/components/expenses/ExpenseListSummary';
import {
  DEFAULT_EXPENSE_FILTERS,
  getActiveExpenseFilterCount,
  getExpenseFiltersQueryKey,
  normalizeExpenseFilters,
} from '@/components/expenses/expense-filters';
import { styles } from '@/components/expenses/expenses-list.styles';
import type { GroupedExpenseListItem } from '@/components/expenses/expenses-list.utils';
import { groupExpensesByMonthAndGroup } from '@/components/expenses/expenses-list-grouping.utils';
import { ScreenSkeleton } from '@/components/ui/ScreenSkeleton';
import { useBranches } from '@/hooks/useBranches';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useExpenseGroups } from '@/hooks/useExpenseGroups';
import { useMerchant } from '@/hooks/useMerchant';
import { useTheme } from '@/hooks/useTheme';
import { supabase } from '@/lib/supabase';
import { ExpenseDisplaySchema } from '@/schemas/expense';

const EXPENSE_LIST_COLUMNS =
  'id, amount, category, description, date, merchant_id, receipt_url, branch_id, group_id, vendor_name, payment_method, reference, receipt_storage_path, created_by_user_id, updated_by_user_id, updated_at';

type Props = { canCreate: boolean; canEdit: boolean };
export function ExpenseListContent({ canCreate, canEdit }: Props) {
  const { colors, shadows, isDark } = useTheme();
  const router = useRouter();
  const { merchant } = useMerchant();
  const { scope } = useBranchScope();
  const {
    data: branches = [],
    error: branchesError,
    refetch: refetchBranches,
  } = useBranches({
    includeInactive: true,
  });
  const {
    allGroups,
    error: groupsError,
    refetch: refetchGroups,
  } = useExpenseGroups();
  const [filters, setFilters] = useState(DEFAULT_EXPENSE_FILTERS);
  const [isFilterSheetVisible, setIsFilterSheetVisible] = useState(false);
  const normalizedFilters = normalizeExpenseFilters(filters, scope);
  const activeFilterCount = getActiveExpenseFilterCount(filters, scope);
  const hasActiveFilters = activeFilterCount > 0;
  const hasDateWindow = normalizedFilters.startDate !== null;
  const expenseQuery = useQuery({
    queryKey: getExpenseFiltersQueryKey(
      merchant?.id ?? 'no-active-merchant',
      normalizedFilters
    ),
    queryFn: async () => {
      if (!merchant?.id) return [];
      let query = supabase
        .from('expenses')
        .select(EXPENSE_LIST_COLUMNS)
        .eq('merchant_id', merchant.id);

      if (normalizedFilters.startDate) {
        query = query.gte('date', normalizedFilters.startDate);
      }
      if (normalizedFilters.endDate) {
        query = query.lte('date', normalizedFilters.endDate);
      }
      if (normalizedFilters.category !== 'all') {
        query = query.eq('category', normalizedFilters.category);
      }
      if (normalizedFilters.branchId !== 'all') {
        query = query.eq('branch_id', normalizedFilters.branchId);
      }
      if (normalizedFilters.groupId === 'ungrouped') {
        query = query.is('group_id', null);
      } else if (normalizedFilters.groupId !== 'all') {
        query = query.eq('group_id', normalizedFilters.groupId);
      }
      const { data, error } = await query
        .order('date', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;
      return ExpenseDisplaySchema.array().parse(data ?? []);
    },
    enabled: Boolean(merchant?.id),
    staleTime: 1000 * 60 * 5,
  });
  const visibleTotal = (expenseQuery.data ?? []).reduce(
    (sum, expense) => sum + expense.amount,
    0
  );
  const summaryLabel = hasActiveFilters ? 'Filtered total' : 'Total this Month';
  const { data: groupedExpenses, stickyHeaderIndices } =
    groupExpensesByMonthAndGroup(expenseQuery.data ?? [], allGroups);
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Expenses',
          headerLeft: () => (
            <Pressable
              accessibilityLabel="Go back"
              accessibilityRole="button"
              onPress={() => router.back()}
              style={styles.headerButton}
            >
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </Pressable>
          ),
          headerRight: canCreate
            ? () => (
                <Pressable
                  accessibilityLabel="Add expense"
                  accessibilityRole="button"
                  onPress={() => router.push('/expenses/new')}
                  style={styles.headerButton}
                >
                  <Ionicons name="add" size={24} color={colors.primary} />
                </Pressable>
              )
            : undefined,
        }}
      />
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={['bottom']}
      >
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
        <ExpenseListSummary
          currency={merchant?.payout_currency ?? 'NGN'}
          label={summaryLabel}
          total={visibleTotal}
        />
        <ExpenseFilterBar
          activeFilterCount={activeFilterCount}
          onOpen={() => setIsFilterSheetVisible(true)}
        />

        {expenseQuery.isLoading ? (
          <ScreenSkeleton variant="list" cards={4} />
        ) : expenseQuery.isError && expenseQuery.data === undefined ? (
          <View style={styles.emptyContainer}>
            <Ionicons
              name="warning-outline"
              size={64}
              color={colors.textMuted}
            />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              Could not load expenses
            </Text>
          </View>
        ) : (
          <FlashList<GroupedExpenseListItem>
            data={groupedExpenses}
            renderItem={({ item }) =>
              item.type === 'header' ? (
                <ExpenseListSectionHeader
                  count={item.count}
                  currency={merchant?.payout_currency ?? 'NGN'}
                  label={item.title}
                  total={item.total}
                  variant="month"
                />
              ) : item.type === 'group-header' ? (
                <ExpenseListSectionHeader
                  count={item.count}
                  currency={merchant?.payout_currency ?? 'NGN'}
                  label={item.title}
                  total={item.total}
                  variant="group"
                />
              ) : (
                <ExpenseListItem
                  canEdit={canEdit}
                  item={item.data}
                  merchant={merchant}
                />
              )
            }
            keyExtractor={(item) => item.key}
            getItemType={(item) => item.type}
            stickyHeaderIndices={stickyHeaderIndices}
            stickyHeaderConfig={{ hideRelatedCell: true, zIndex: 10 }}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons
                  name="receipt-outline"
                  size={64}
                  color={colors.textMuted}
                />
                <Text
                  style={[styles.emptyText, { color: colors.textSecondary }]}
                >
                  {hasActiveFilters
                    ? 'No expenses match these filters'
                    : hasDateWindow
                      ? 'No expenses recorded in this period'
                      : 'No expenses recorded yet'}
                </Text>
                {canCreate ? (
                  <Pressable
                    accessibilityLabel="Add your first expense"
                    accessibilityRole="button"
                    style={[
                      styles.emptyButton,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                      },
                    ]}
                    onPress={() => router.push('/expenses/new')}
                  >
                    <Text
                      style={[
                        styles.emptyButtonText,
                        { color: colors.primary },
                      ]}
                    >
                      Add your first expense
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            }
          />
        )}

        {canCreate ? (
          <Pressable
            accessibilityLabel="Add expense"
            accessibilityRole="button"
            style={[
              styles.fab,
              { backgroundColor: colors.primary },
              shadows.lg,
            ]}
            onPress={() => router.push('/expenses/new')}
          >
            <Ionicons name="add" size={32} color={colors.textOnPrimary} />
          </Pressable>
        ) : null}
        <ExpenseFiltersSheet
          branchScope={scope}
          branches={branches.map((branch) => ({
            id: branch.id,
            name: branch.active ? branch.name : `${branch.name} (inactive)`,
          }))}
          filters={filters}
          groups={allGroups}
          onApply={(nextFilters) => {
            setFilters(nextFilters);
          }}
          onClose={() => setIsFilterSheetVisible(false)}
          onRetry={() => {
            void refetchBranches();
            void refetchGroups();
          }}
          visible={isFilterSheetVisible}
          dependencyError={branchesError ?? groupsError}
        />
      </SafeAreaView>
    </>
  );
}
