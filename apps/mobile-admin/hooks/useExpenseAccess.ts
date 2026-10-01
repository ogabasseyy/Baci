import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useMerchant } from '@/hooks/useMerchant';
import { supabase } from '@/lib/supabase';
import {
  type ExpenseAccess,
  ExpenseAccessRowSchema,
  resolveExpenseAccess,
} from '@/schemas/expense-access';

const deniedExpenseAccess: ExpenseAccess = {
  canView: false,
  canCreate: false,
  canEdit: false,
  canManageIntegrations: false,
};

async function fetchExpenseAccess(merchantId: string): Promise<ExpenseAccess> {
  const { data, error } = await supabase.rpc('get_user_access');

  if (error) {
    throw new Error(error.message);
  }

  const rows = ExpenseAccessRowSchema.array().safeParse(data);
  if (!rows.success) {
    throw new Error('Received an invalid expense access response');
  }

  const activeMerchantAccess = rows.data.find(
    (access) => access.merchant_id === merchantId
  );

  if (!activeMerchantAccess) {
    throw new Error('No expense access was returned for the active merchant');
  }

  return resolveExpenseAccess(activeMerchantAccess);
}

export function useExpenseAccess(): ExpenseAccess & {
  isLoading: boolean;
  isRefreshing: boolean;
  error: Error | null;
} {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { merchant, isLoading: isMerchantLoading } = useMerchant();
  const userId = user?.id;
  const merchantId = merchant?.id;
  const hasAccessContext = Boolean(userId && merchantId);

  const query = useQuery({
    queryKey: ['user-access', userId, merchantId],
    queryFn: () => {
      if (!merchantId) throw new Error('No active merchant');
      return fetchExpenseAccess(merchantId);
    },
    enabled: hasAccessContext,
    retry: false,
    staleTime: 1000 * 60 * 5,
  });

  const isRefreshing = Boolean(query.isFetching && query.data);
  const isLoading = Boolean(
    isAuthLoading || isMerchantLoading || (query.isLoading && !query.data)
  );
  const error = query.error instanceof Error ? query.error : null;
  const access = query.data ?? deniedExpenseAccess;

  return { ...access, isLoading, isRefreshing, error };
}
