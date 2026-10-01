import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMerchant } from '@/hooks/useMerchant';
import { supabase } from '@/lib/supabase';
import {
  type ExpenseGroup,
  ExpenseGroupIdSchema,
  ExpenseGroupNameSchema,
  ExpenseGroupSchema,
} from '@/schemas/expense-group';

const EXPENSE_GROUP_COLUMNS =
  'id, merchant_id, name, archived_at, created_at, updated_at';

interface CreateExpenseGroupInput {
  merchantId: string;
  name: string;
}

interface RenameExpenseGroupInput extends CreateExpenseGroupInput {
  id: string;
}

interface ArchiveExpenseGroupInput {
  id: string;
  merchantId: string;
}

export interface UseExpenseGroupsResult {
  activeGroups: ExpenseGroup[];
  allGroups: ExpenseGroup[];
  hasCachedGroups: boolean;
  isError: boolean;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  createGroup: (name: string) => Promise<ExpenseGroup>;
  renameGroup: (id: string, name: string) => Promise<void>;
  archiveGroup: (id: string) => Promise<void>;
}

function parseGroupName(name: string): string {
  return ExpenseGroupNameSchema.parse(name);
}

function parseGroupId(id: string): string {
  return ExpenseGroupIdSchema.parse(id);
}

function duplicateNameError(error: { code?: string; message: string }): Error {
  if (error.code === '23505') {
    return new Error('An active expense group with this name already exists.');
  }

  return new Error(error.message);
}

async function fetchExpenseGroups(
  merchantId: string,
  activeOnly: boolean
): Promise<ExpenseGroup[]> {
  let query = supabase
    .from('expense_groups')
    .select(EXPENSE_GROUP_COLUMNS)
    .eq('merchant_id', merchantId);

  if (activeOnly) {
    query = query.is('archived_at', null);
  }

  const { data, error } = await query.order('name', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return ExpenseGroupSchema.array().parse(data);
}

async function createExpenseGroup({
  merchantId,
  name,
}: CreateExpenseGroupInput): Promise<ExpenseGroup> {
  const { data, error } = await supabase
    .from('expense_groups')
    .insert({ merchant_id: merchantId, name: parseGroupName(name) })
    .select(EXPENSE_GROUP_COLUMNS)
    .single();

  if (error) {
    throw duplicateNameError(error);
  }

  return ExpenseGroupSchema.parse(data);
}

async function renameExpenseGroup({
  id,
  merchantId,
  name,
}: RenameExpenseGroupInput): Promise<void> {
  const groupId = parseGroupId(id);
  const { data, error } = await supabase
    .from('expense_groups')
    .update({ name: parseGroupName(name) })
    .eq('id', groupId)
    .eq('merchant_id', merchantId)
    .select(EXPENSE_GROUP_COLUMNS)
    .single();

  if (error) {
    throw duplicateNameError(error);
  }

  ExpenseGroupSchema.parse(data);
}

async function archiveExpenseGroup({
  id,
  merchantId,
}: ArchiveExpenseGroupInput): Promise<void> {
  const groupId = parseGroupId(id);
  const { data, error } = await supabase
    .from('expense_groups')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', groupId)
    .eq('merchant_id', merchantId)
    .select(EXPENSE_GROUP_COLUMNS)
    .single();

  if (error) {
    throw duplicateNameError(error);
  }

  ExpenseGroupSchema.parse(data);
}

export function useExpenseGroups(): UseExpenseGroupsResult {
  const { merchant } = useMerchant();
  const merchantId = merchant?.id ?? null;
  const queryClient = useQueryClient();
  const allGroupsQuery = useQuery({
    queryKey: ['expense-groups', merchantId, 'all'],
    queryFn: () => {
      if (!merchantId) throw new Error('No active merchant');
      return fetchExpenseGroups(merchantId, false);
    },
    enabled: Boolean(merchantId),
  });
  const invalidateGroups = async (activeMerchantId: string) => {
    await queryClient.invalidateQueries({
      queryKey: ['expense-groups', activeMerchantId],
    });
  };
  const createMutation = useMutation({
    mutationFn: createExpenseGroup,
    retry: false,
    onSuccess: async (_group, input) => invalidateGroups(input.merchantId),
  });
  const renameMutation = useMutation({
    mutationFn: renameExpenseGroup,
    onSuccess: async (_result, input) => invalidateGroups(input.merchantId),
  });
  const archiveMutation = useMutation({
    mutationFn: archiveExpenseGroup,
    onSuccess: async (_result, input) => invalidateGroups(input.merchantId),
  });

  const requireMerchantId = (): string => {
    if (!merchantId) throw new Error('No active merchant');
    return merchantId;
  };

  return {
    activeGroups: (allGroupsQuery.data ?? []).filter(
      (group) => group.archived_at === null
    ),
    allGroups: allGroupsQuery.data ?? [],
    hasCachedGroups: allGroupsQuery.data !== undefined,
    isError: allGroupsQuery.isError,
    error: allGroupsQuery.error instanceof Error ? allGroupsQuery.error : null,
    refetch: async () => {
      await allGroupsQuery.refetch();
    },
    isLoading: allGroupsQuery.isFetching,
    createGroup: async (name) =>
      createMutation.mutateAsync({ merchantId: requireMerchantId(), name }),
    renameGroup: async (id, name) => {
      await renameMutation.mutateAsync({
        id,
        merchantId: requireMerchantId(),
        name,
      });
    },
    archiveGroup: async (id) => {
      await archiveMutation.mutateAsync({
        id,
        merchantId: requireMerchantId(),
      });
    },
  };
}
