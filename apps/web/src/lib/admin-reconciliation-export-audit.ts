import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

interface ReconciliationExportAuditResult {
  data: string | null;
  error: { code?: string | null; message: string } | null;
}

type ReconciliationExportAuditRpc = (
  functionName: 'write_admin_reconciliation_export_event_v1'
) => PromiseLike<ReconciliationExportAuditResult>;

export async function writeAdminReconciliationExportEvent(
  supabase: SupabaseClient<Database>
): Promise<ReconciliationExportAuditResult> {
  const rpc = supabase.rpc as unknown as ReconciliationExportAuditRpc;
  return await rpc('write_admin_reconciliation_export_event_v1');
}
