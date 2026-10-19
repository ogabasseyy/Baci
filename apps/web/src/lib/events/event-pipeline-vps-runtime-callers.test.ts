import { describe, expect, it } from 'vitest';
import { eventPipelineVpsRuntimeCallers } from './event-pipeline-vps-runtime-callers';

describe('eventPipelineVpsRuntimeCallers', () => {
  it('binds expense cleanup workers to their RPC claims', () => {
    expect(eventPipelineVpsRuntimeCallers).toEqual({
      'vps-workers/jobs/cleanup-legacy-expense-receipts.mjs': [
        'authorize_legacy_expense_receipt_cleanup_deletion',
        'claim_legacy_expense_receipt_cleanup_candidates',
        'complete_legacy_expense_receipt_cleanup',
      ],
      'vps-workers/jobs/cleanup-private-expense-receipts.mjs': [
        'authorize_expense_private_receipt_cleanup_deletion',
        'claim_expense_private_receipt_cleanup_candidates',
        'complete_expense_private_receipt_cleanup',
      ],
      'vps-workers/jobs/supabase-retention-cleanup.mjs': [
        'cleanup_domain_event_pipeline_v1',
      ],
    });
  });
});
