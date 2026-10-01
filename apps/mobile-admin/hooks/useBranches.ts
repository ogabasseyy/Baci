/**
 * useBranches Hook
 * Manages branch data fetching, active branch state, and branch creation
 * 2026 Best Practice: TanStack Query + MMKV persistence + Zod validation
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMerchant } from '@/hooks/useMerchant';
import { getBranchesQueryKey } from './branch-query-key';

export { getBranchesQueryKey } from './branch-query-key';

import {
  createBranch as createBranchViaApi,
  deactivateBranch as deactivateBranchViaApi,
  updateBranch as updateBranchViaApi,
} from '@/lib/branch-api';
import { storage } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import {
  type Branch,
  BranchSchema,
  type CreateBranchInput,
  type UpdateBranchInput,
} from '@/schemas/branch';

const ACTIVE_BRANCH_KEY = 'active-branch-id';

/**
 * Get the persisted active branch ID from MMKV
 */
function getPersistedBranchId(): string | null {
  return storage.getString(ACTIVE_BRANCH_KEY) ?? null;
}

/**
 * Persist the active branch ID to MMKV
 */
function persistBranchId(branchId: string | null): void {
  if (branchId) {
    storage.set(ACTIVE_BRANCH_KEY, branchId);
  } else {
    storage.remove(ACTIVE_BRANCH_KEY);
  }
}

/**
 * Fetch all branches for the current merchant
 */
const BRANCH_COLUMNS =
  'id, merchant_id, name, address, city, state, phone, manager_id, is_default, active, created_at, updated_at' as const;

async function fetchBranches(
  merchantId: string,
  includeInactive = false
): Promise<Branch[]> {
  let query = supabase
    .from('branches')
    .select(BRANCH_COLUMNS)
    .eq('merchant_id', merchantId);
  if (!includeInactive) query = query.eq('active', true);
  const { data, error } = await query
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[Branches] Fetch error:', error);
    throw new Error(error.message);
  }

  // Validate with Zod - THROW if invalid to catch schema drift early
  return BranchSchema.array().parse(data);
}

/**
 * Hook to list all branches for the current merchant
 */
export function useBranches({
  includeInactive = false,
}: {
  includeInactive?: boolean;
} = {}) {
  const { merchant } = useMerchant();

  return useQuery({
    queryKey: getBranchesQueryKey(merchant?.id, includeInactive),
    queryFn: () => {
      if (!merchant?.id) throw new Error('No merchant');
      return fetchBranches(merchant.id, includeInactive);
    },
    enabled: !!merchant?.id,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * Hook to get/set the currently active branch
 * Persists selection to MMKV
 */
export function useActiveBranch() {
  const { data: branches = [] } = useBranches();
  const queryClient = useQueryClient();

  // Get persisted branch ID (Reactive via Query)
  const { data: persistedId } = useQuery({
    queryKey: [ACTIVE_BRANCH_KEY],
    queryFn: () => getPersistedBranchId(),
    initialData: getPersistedBranchId(),
    staleTime: Number.POSITIVE_INFINITY, // Only update via manual invalidation in setActiveBranch
  });

  // Find active branch: persisted > default > first
  const activeBranch =
    branches.find((b) => b.id === persistedId) ??
    branches.find((b) => b.is_default) ??
    branches[0] ??
    null;

  const setActiveBranch = (branchId: string | null) => {
    persistBranchId(branchId);
    // Invalidate the active-branch-id query to trigger re-render
    queryClient.invalidateQueries({ queryKey: [ACTIVE_BRANCH_KEY] });
  };

  return {
    activeBranch,
    activeBranchId: activeBranch?.id ?? null,
    setActiveBranch,
    branches,
    hasBranches: branches.length > 0,
  };
}

/**
 * Hook to create a new branch
 */
export function useCreateBranch() {
  const { merchant } = useMerchant();
  const queryClient = useQueryClient();
  const merchantId = merchant?.id?.trim() || null;

  return useMutation({
    mutationFn: (input: CreateBranchInput) => {
      if (!merchantId) throw new Error('No merchant');
      return createBranchViaApi(input, merchantId);
    },
    onSuccess: () => {
      // Invalidate branches query to refetch
      queryClient.invalidateQueries({ queryKey: ['branches'] });
      queryClient.invalidateQueries({ queryKey: ['branch-scope'] });
    },
  });
}

export function useUpdateBranch() {
  const { merchant } = useMerchant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      branchId,
      input,
    }: {
      branchId: string;
      input: UpdateBranchInput;
    }) => {
      if (!merchant?.id) throw new Error('No merchant');
      return updateBranchViaApi(branchId, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branches'] });
      queryClient.invalidateQueries({ queryKey: ['branch-scope'] });
    },
  });
}

export function useDeactivateBranch() {
  const { merchant } = useMerchant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (branchId: string) => {
      if (!merchant?.id) throw new Error('No merchant');
      return deactivateBranchViaApi(branchId);
    },
    onSuccess: (_data, branchId) => {
      if (getPersistedBranchId() === branchId) {
        persistBranchId(null);
        queryClient.invalidateQueries({ queryKey: [ACTIVE_BRANCH_KEY] });
      }
      queryClient.invalidateQueries({ queryKey: ['branches'] });
      queryClient.invalidateQueries({ queryKey: ['branch-scope'] });
    },
  });
}
