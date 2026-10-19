import { describe, expect, it, vi } from 'vitest';
import { writeAdminReconciliationExportEvent } from './admin-reconciliation-export-audit';

describe('writeAdminReconciliationExportEvent', () => {
  it('calls only the fixed zero-input audit RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'audit-id', error: null });

    await expect(
      writeAdminReconciliationExportEvent({ rpc } as never)
    ).resolves.toEqual({ data: 'audit-id', error: null });
    expect(rpc).toHaveBeenCalledWith(
      'write_admin_reconciliation_export_event_v1'
    );
  });
});
