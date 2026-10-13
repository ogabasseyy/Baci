import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { ExpenseEditForm } from '@/components/expenses/ExpenseEditForm';
import { ExpenseStatusShell } from '@/components/expenses/ExpenseStatusShell';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useExpenseAccess } from '@/hooks/useExpenseAccess';
import { useMerchant } from '@/hooks/useMerchant';
import { useTheme } from '@/hooks/useTheme';
import { supabase } from '@/lib/supabase';
import { ExpenseDisplaySchema } from '@/schemas/expense';
import { ExpenseRouteParamsSchema } from '@/schemas/expense-route-params';
import { shouldResetExpenseEditDraftOnReload } from './expense-edit-reload';

const EDIT_EXPENSE_COLUMNS =
  'id, merchant_id, amount, category, description, date, receipt_url, receipt_storage_path, branch_id, group_id, vendor_name, payment_method, reference, created_by_user_id, updated_by_user_id, updated_at';

function AuthorizedExpenseEdit({
  canEdit,
  expenseId,
  isRefreshing,
}: {
  canEdit: boolean;
  expenseId: string;
  isRefreshing: boolean;
}) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [reloadNonce, setReloadNonce] = useState(0);
  const { merchant } = useMerchant();
  const { scope } = useBranchScope();
  const query = useQuery({
    queryKey: [
      'expense',
      merchant?.id,
      scope.type === 'branch' ? scope.branchId : 'all',
      expenseId,
    ],
    queryFn: async () => {
      if (!merchant?.id) throw new Error('Merchant ID missing');
      let request = supabase
        .from('expenses')
        .select(EDIT_EXPENSE_COLUMNS)
        .eq('id', expenseId)
        .eq('merchant_id', merchant.id);
      if (scope.type === 'branch')
        request = request.eq('branch_id', scope.branchId);
      const { data, error } = await request.maybeSingle();
      if (error) throw new Error(error.message);
      return data ? ExpenseDisplaySchema.parse(data) : null;
    },
    enabled: Boolean(merchant?.id),
  });
  if (query.isLoading)
    return <ExpenseStatusShell colors={colors} status="loading" />;
  if (query.isError && !query.data)
    return (
      <ExpenseStatusShell
        colors={colors}
        errorMessage={
          query.error instanceof Error ? query.error.message : undefined
        }
        status="error"
      />
    );
  if (!query.data)
    return <ExpenseStatusShell colors={colors} status="not-found" />;
  return (
    <ExpenseEditForm
      key={`${query.data.id}:${reloadNonce}`}
      canEdit={canEdit}
      expense={query.data}
      isRefreshing={isRefreshing}
      onReload={() => {
        void queryClient.invalidateQueries({
          queryKey: ['expense', merchant?.id],
        });
        void query.refetch().then((result) => {
          if (shouldResetExpenseEditDraftOnReload(result)) {
            setReloadNonce((value) => value + 1);
            return;
          }
          if (result.isError) {
            Alert.alert(
              'Reload failed',
              result.error instanceof Error
                ? result.error.message
                : 'Could not reload the latest expense.'
            );
          }
        });
      }}
    />
  );
}

function EditExpenseAccessStatus({
  errorMessage,
  status,
}: {
  errorMessage?: string;
  status: 'denied' | 'error' | 'loading' | 'not-found';
}) {
  const { colors } = useTheme();
  if (status === 'denied') {
    return (
      <ExpenseStatusShell
        colors={colors}
        errorMessage="You do not have permission to edit expenses."
        status="denied"
      />
    );
  }
  return (
    <ExpenseStatusShell
      colors={colors}
      errorMessage={errorMessage}
      status={status}
    />
  );
}

export default function EditExpenseScreen() {
  const { canEdit, error, isLoading, isRefreshing } = useExpenseAccess();
  const params = useLocalSearchParams<{ id?: string }>();
  const route = ExpenseRouteParamsSchema.safeParse({ id: params.id });
  if (isLoading) return <EditExpenseAccessStatus status="loading" />;
  if (!canEdit)
    return error ? (
      <EditExpenseAccessStatus errorMessage={error.message} status="error" />
    ) : (
      <EditExpenseAccessStatus status="denied" />
    );
  if (!route.success) return <EditExpenseAccessStatus status="not-found" />;
  return (
    <AuthorizedExpenseEdit
      expenseId={route.data.id}
      canEdit
      isRefreshing={isRefreshing}
    />
  );
}
