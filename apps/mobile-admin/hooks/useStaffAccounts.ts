/**
 * useStaffAccounts
 * Queries and mutations for staff payment accounts and branches
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { z } from 'zod';
import type { Branch, StaffAccount } from '@/components/staff/types';
import { useMerchant } from '@/hooks/useMerchant';
import { BASE_URL } from '@/lib/api-client';
import { createBranch as createBranchViaApi } from '@/lib/branch-api';
import { supabase } from '@/lib/supabase';
import { CreateBranchSchema } from '@/schemas/branch';
import { getBranchesQueryKey } from './branch-query-key';
import { useStaffMutationLifecycle } from './useStaffMutationLifecycle';

// 2026 Best Practice: Dynamic imports for native modules
let Clipboard: typeof import('expo-clipboard') | null = null;

const loadClipboardModule = async () => {
  if (Clipboard) return Clipboard;
  try {
    const cb = await import('expo-clipboard');
    Clipboard = cb;
    return Clipboard;
  } catch (_e) {
    console.debug('[StaffAccounts] Clipboard module ignored or failed to load');
    return null;
  }
};

// Module-scope helper keeps throw-inside-try out of the hook body so
// React Compiler can memoize components that call useStaffAccounts.
const copyToClipboard = async (text: string) => {
  try {
    const clipboard = await loadClipboardModule();
    if (!clipboard?.setStringAsync) {
      throw new Error('Clipboard is not available');
    }
    await clipboard.setStringAsync(text);
    Alert.alert('Copied!', 'Account number copied to clipboard.');
  } catch (_error) {
    Alert.alert('Error', 'Failed to copy to clipboard');
  }
};

interface UseStaffAccountsCallbacks {
  onAccountCreated: () => void;
  onBranchCreated?: () => void;
}

export function useStaffAccounts(callbacks: UseStaffAccountsCallbacks) {
  const {
    merchant,
    isLoading: merchantLoading,
    error: merchantError,
  } = useMerchant();
  const queryClient = useQueryClient();
  const merchantId = merchant?.id?.trim() || null;
  const lifecycle = useStaffMutationLifecycle(merchantId);

  const {
    data: accounts,
    isLoading: accountsLoading,
    isError: accountsError,
    refetch: refetchAccounts,
  } = useQuery({
    queryKey: ['staff-accounts', merchantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('virtual_terminals')
        .select(
          'id, code, name, account_number, account_name, bank, payment_link, active, branch_id, staff_id'
        )
        .eq('merchant_id', merchantId)
        .order('created_at', { ascending: false });
      if (error) {
        console.error('[StaffAccounts] Failed to load staff accounts', error);
        throw new Error(`Failed to load staff accounts: ${error.message}`);
      }
      return (data || []) as StaffAccount[];
    },
    enabled: !!merchantId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const {
    data: branches,
    isLoading: branchesLoading,
    isError: branchesError,
    refetch: refetchBranches,
  } = useQuery({
    queryKey: getBranchesQueryKey(merchantId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('branches')
        .select('id, name, address, city, is_default, active')
        .eq('merchant_id', merchantId)
        .eq('active', true)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true });
      if (error) {
        console.error('[StaffAccounts] Failed to load branches', error);
        throw new Error(`Failed to load branches: ${error.message}`);
      }
      return (data || []) as Branch[];
    },
    enabled: !!merchantId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const createAccountMutation = useMutation({
    mutationFn: async ({
      name,
      staffId,
      branchId,
    }: {
      name: string;
      staffId?: string | null;
      branchId?: string | null;
    }) => {
      if (!merchantId) {
        throw new Error('Merchant not found');
      }
      const schema = z.object({
        name: z.string().min(2, 'Account name must be at least 2 characters'),
      });
      const validation = schema.safeParse({ name });
      if (!validation.success) {
        throw new Error(validation.error.issues[0].message);
      }

      const sessionResponse = await supabase.auth.getSession();

      if (sessionResponse.error) {
        throw new Error(
          `Failed to read current session: ${sessionResponse.error.message}`
        );
      }

      const session = sessionResponse.data.session;

      if (!session?.access_token) {
        throw new Error('Authentication required to create a staff account');
      }

      const response = await fetch(
        `${BASE_URL}/api/paystack/virtual-terminal`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            merchantId,
            name,
            staffId: staffId || undefined,
            branchId: branchId || undefined,
            destinations: [],
          }),
        }
      );
      if (!response.ok) {
        let errorMessage = 'Failed to create account';
        try {
          const error = await response.json();
          errorMessage = error.error || errorMessage;
        } catch {
          // Response wasn't JSON, use default message
        }
        throw new Error(errorMessage);
      }
      return response.json();
    },
    onMutate: () => lifecycle.captureScope(),
    onSuccess: (_data, _variables, scope) => {
      if (!lifecycle.isCurrentScope(scope)) return;
      queryClient.invalidateQueries({
        queryKey: ['staff-accounts', scope.merchantId],
      });
      callbacks.onAccountCreated();
      Alert.alert('Success', 'Staff account created successfully!');
    },
    onError: (error: Error, _variables, scope) => {
      if (!lifecycle.isCurrentScope(scope)) return;
      Alert.alert('Error', error.message);
    },
  });

  const createBranchMutation = useMutation({
    mutationFn: ({ name, city }: { name: string; city?: string }) => {
      if (!merchantId) {
        throw new Error('Merchant not found');
      }

      const normalizedCity = city?.trim() || undefined;
      const validation = CreateBranchSchema.safeParse({
        name,
        city: normalizedCity,
      });
      if (!validation.success) {
        throw new Error(validation.error.issues[0].message);
      }

      return createBranchViaApi(validation.data, merchantId);
    },
    onMutate: () => lifecycle.captureScope(),
    onSuccess: (_data, _variables, scope) => {
      if (!lifecycle.isCurrentScope(scope)) return;
      queryClient.invalidateQueries({
        queryKey: getBranchesQueryKey(scope.merchantId),
      });
      queryClient.invalidateQueries({
        queryKey: getBranchesQueryKey(scope.merchantId, true),
      });
      queryClient.invalidateQueries({ queryKey: ['branch-scope'] });
      callbacks.onBranchCreated?.();
      Alert.alert('Success', 'Branch created successfully!');
    },
    onError: (error: Error, _variables, scope) => {
      if (!lifecycle.isCurrentScope(scope)) return;
      Alert.alert('Error', error.message);
    },
  });

  const retryAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['merchant'] });
    void refetchAccounts();
    void refetchBranches();
  };

  return {
    accounts,
    branches,
    isLoading: merchantLoading || accountsLoading || branchesLoading,
    hasError: Boolean(merchantError || accountsError || branchesError),
    createAccountMutation,
    createBranchMutation,
    copyToClipboard,
    retryAll,
  };
}
