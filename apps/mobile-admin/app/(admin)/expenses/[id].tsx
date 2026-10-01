import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StatusBar, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ExpenseDetails } from '@/components/expenses/ExpenseDetails';
import { ExpenseStatusShell } from '@/components/expenses/ExpenseStatusShell';
import { styles } from '@/components/expenses/expense-detail.styles';
import { useBranches } from '@/hooks/useBranches';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useExpenseAccess } from '@/hooks/useExpenseAccess';
import { useExpenseBranchLabel } from '@/hooks/useExpenseBranchLabel';
import { useExpenseGroups } from '@/hooks/useExpenseGroups';
import { useExpenseReceiptUrl } from '@/hooks/useExpenseReceiptUrl';
import { useMerchant } from '@/hooks/useMerchant';
import { useTheme } from '@/hooks/useTheme';
import { getBranchScopeKey } from '@/lib/branch-scope-query';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';
import { ExpenseDisplaySchema } from '@/schemas/expense';
import { ExpenseRouteParamsSchema } from '@/schemas/expense-route-params';

const DETAIL_EXPENSE_COLUMNS =
  'id, merchant_id, amount, category, description, date, receipt_url, receipt_storage_path, branch_id, group_id, vendor_name, payment_method, reference, created_by_user_id, updated_by_user_id, updated_at';

function AuthorizedExpenseDetail({
  canEdit,
  expenseId,
}: {
  canEdit: boolean;
  expenseId: string;
}) {
  const { colors, isDark, shadows } = useTheme();
  const router = useRouter();
  const { merchant } = useMerchant();
  const { scope } = useBranchScope();
  const { data: branches = [], isLoading: branchesLoading } = useBranches();
  const branchScopeKey = getBranchScopeKey(scope);
  const expenseQuery = useQuery({
    queryKey: ['expense', merchant?.id, branchScopeKey, expenseId],
    queryFn: async () => {
      if (!merchant?.id) throw new Error('Merchant ID missing');
      let query = supabase
        .from('expenses')
        .select(DETAIL_EXPENSE_COLUMNS)
        .eq('id', expenseId)
        .eq('merchant_id', merchant.id);
      if (scope.type === 'branch')
        query = query.eq('branch_id', scope.branchId);
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data ? ExpenseDisplaySchema.parse(data) : null;
    },
    enabled: Boolean(merchant?.id),
  });
  const expense = expenseQuery.data;
  const branchName = useExpenseBranchLabel({
    branchId: expense?.branch_id,
    branches,
    branchesLoading,
    merchantId: merchant?.id,
  });
  const {
    allGroups,
    isError: groupsError,
    isLoading: groupsLoading,
  } = useExpenseGroups();
  const receipt = useExpenseReceiptUrl({
    legacyReceiptUrl: expense?.receipt_url ?? null,
    merchantId: merchant?.id ?? '',
    receiptStoragePath: expense?.receipt_storage_path ?? null,
  });
  const groupName = expense?.group_id
    ? (allGroups.find((group) => group.id === expense.group_id)?.name ??
      (groupsLoading
        ? 'Loading group...'
        : groupsError
          ? 'Group unavailable'
          : 'Unknown group'))
    : 'Ungrouped';
  let content: ReactNode;
  if (expenseQuery.isLoading) {
    content = <ExpenseStatusShell colors={colors} status="loading" />;
  } else if (expenseQuery.isError && !expense) {
    content = (
      <ExpenseStatusShell
        colors={colors}
        errorMessage={
          expenseQuery.error instanceof Error
            ? expenseQuery.error.message
            : undefined
        }
        status="error"
      />
    );
  } else if (!expense) {
    content = <ExpenseStatusShell colors={colors} status="not-found" />;
  } else {
    content = (
      <ExpenseDetails
        branchName={branchName}
        cardShadow={shadows.sm}
        colors={colors}
        expense={expense}
        formattedAmount={formatCurrency(
          expense.amount,
          undefined,
          merchant?.payout_currency ?? 'NGN'
        )}
        groupName={groupName}
        receiptError={receipt.error}
        receiptLoading={receipt.isLoading}
        receiptUrl={receipt.url}
      />
    );
  }
  return (
    <SafeAreaView
      edges={['bottom']}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <Stack.Screen
        options={{
          title: 'Expense Details',
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          headerRight:
            canEdit && expense
              ? () => (
                  <Pressable
                    accessibilityLabel="Edit expense"
                    accessibilityRole="button"
                    onPress={() => router.push(`/expenses/${expense.id}/edit`)}
                  >
                    <Text style={{ color: colors.primary }}>Edit</Text>
                  </Pressable>
                )
              : undefined,
        }}
      />
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      {content}
    </SafeAreaView>
  );
}

export default function ExpenseDetailScreen() {
  const { colors } = useTheme();
  const { canEdit, canView, error, isLoading } = useExpenseAccess();
  const params = useLocalSearchParams<{ id?: string }>();
  const route = ExpenseRouteParamsSchema.safeParse({ id: params.id });
  if (isLoading) return <ExpenseStatusShell colors={colors} status="loading" />;
  if (!canView) {
    return error ? (
      <ExpenseStatusShell
        colors={colors}
        errorMessage={error.message}
        status="error"
      />
    ) : (
      <ExpenseStatusShell
        colors={colors}
        errorMessage="You do not have permission to view expenses"
        status="denied"
      />
    );
  }
  if (!route.success)
    return <ExpenseStatusShell colors={colors} status="not-found" />;
  return (
    <AuthorizedExpenseDetail canEdit={canEdit} expenseId={route.data.id} />
  );
}
