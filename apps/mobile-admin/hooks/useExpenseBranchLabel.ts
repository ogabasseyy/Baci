import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { ExpenseBranchLabelSchema } from '@/schemas/expense-branch-label';

interface BranchLabelOption {
  id: string;
  name: string;
}

interface UseExpenseBranchLabelInput {
  branchId: string | null | undefined;
  branches: readonly BranchLabelOption[];
  branchesLoading: boolean;
  merchantId: string | null | undefined;
}

export function useExpenseBranchLabel({
  branchId,
  branches,
  branchesLoading,
  merchantId,
}: UseExpenseBranchLabelInput): string {
  const activeBranchName = branchId
    ? branches.find((branch) => branch.id === branchId)?.name
    : undefined;
  const historicalBranchQuery = useQuery({
    queryKey: ['expense-branch', merchantId, branchId],
    queryFn: async () => {
      if (!(merchantId && branchId)) return null;
      const { data, error } = await supabase
        .from('branches')
        .select('id, name')
        .eq('id', branchId)
        .eq('merchant_id', merchantId)
        .maybeSingle();
      if (error) throw error;
      return data ? ExpenseBranchLabelSchema.parse(data) : null;
    },
    enabled: Boolean(
      merchantId && branchId && !activeBranchName && !branchesLoading
    ),
  });

  if (!branchId) return 'Unassigned';
  return (
    activeBranchName ??
    historicalBranchQuery.data?.name ??
    (branchesLoading || historicalBranchQuery.isLoading
      ? 'Loading branch...'
      : 'Unknown branch')
  );
}
