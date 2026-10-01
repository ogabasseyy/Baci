import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

interface PlatformAuditExportWriteResult {
  data: string | null;
  error: { code?: string; message: string } | null;
}

type PlatformAuditExportWriter = (
  functionName: 'write_platform_audit_export_event_v1'
) => Promise<PlatformAuditExportWriteResult>;

/**
 * Records an audit export without accepting caller-controlled audit fields.
 * PostgreSQL fixes the action, resource and metadata under audit.read.
 */
export function writePlatformAuditExportEvent(
  supabase: SupabaseClient<Database>
): Promise<PlatformAuditExportWriteResult> {
  // Generated Database typings must include this RPC after migration replay.
  const write = supabase.rpc as unknown as PlatformAuditExportWriter;
  return write('write_platform_audit_export_event_v1');
}
