import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@/types/supabase';
import { writePlatformAuditExportEvent } from './platform-audit-export';

describe('writePlatformAuditExportEvent', () => {
  it('invokes the zero-input fixed-shape export RPC without caller-controlled fields', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'event-id', error: null });
    const supabase = { rpc } as unknown as SupabaseClient<Database>;

    await writePlatformAuditExportEvent(supabase);

    expect(rpc).toHaveBeenCalledWith('write_platform_audit_export_event_v1');
  });
});
