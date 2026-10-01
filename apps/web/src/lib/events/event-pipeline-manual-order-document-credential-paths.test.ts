import { describe, expect, it } from 'vitest';
import { eventPipelineManualOrderDocumentCredentialPaths } from './event-pipeline-manual-order-document-credential-paths';

describe('eventPipelineManualOrderDocumentCredentialPaths', () => {
  it('allows only the audited manual-order document credential paths', () => {
    expect(eventPipelineManualOrderDocumentCredentialPaths).toHaveLength(9);
    expect(eventPipelineManualOrderDocumentCredentialPaths).toContainEqual([
      'apps/web/src/app/api/cron/order-notifications/order-notification-outbox-worker.ts',
      'apps/web/src/lib/send-manual-order-document.ts',
      'apps/web/src/lib/import-notifications/receipt-claim-links.ts',
      'apps/web/src/env.ts',
    ]);
    expect(eventPipelineManualOrderDocumentCredentialPaths).toContainEqual([
      'apps/web/src/lib/send-manual-order-document.ts',
      'apps/web/src/lib/zeptomail.ts',
      'apps/web/src/lib/supabase/admin.ts',
      'apps/web/src/env.ts',
    ]);
  });
});
