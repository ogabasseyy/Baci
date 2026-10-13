import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdminOperationsQuery } from '@/schemas/admin-operations-query';
import {
  type AdminOperations,
  adminOperationsRpcSchema,
} from '@/schemas/admin-operations-rpc';
import type { Database } from '@/types/supabase';

interface AdminOperationsError {
  code?: string | null;
  message: string;
}

export async function getAdminOperations(
  supabase: SupabaseClient<Database>,
  query: AdminOperationsQuery
): Promise<{
  data: AdminOperations | null;
  error: AdminOperationsError | null;
}> {
  // This RPC is added by the same migration as this module. The generated
  // Database type is refreshed separately from migration authoring.
  const rpc = supabase.rpc as unknown as (
    name: 'get_admin_operations_v2',
    args: { p_limit: number; p_offset: number; p_section: string }
  ) => Promise<{ data: unknown; error: AdminOperationsError | null }>;
  const result = await rpc('get_admin_operations_v2', {
    p_limit: query.limit,
    p_offset: query.offset,
    p_section: query.section,
  });

  if (result.error) return { data: null, error: result.error };

  const parsed = adminOperationsRpcSchema.safeParse(result.data);
  if (!parsed.success) {
    return {
      data: null,
      error: {
        code: 'INVALID_OPERATIONS_PAYLOAD',
        message: 'Operations read model returned an invalid payload',
      },
    };
  }

  return { data: parsed.data, error: null };
}
