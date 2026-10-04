import { describe, expect, it } from 'vitest';
import { eventPipelineCoreCredentialPaths } from './event-pipeline-core-credential-paths';

describe('eventPipelineCoreCredentialPaths', () => {
  it('allows only the audited legacy core credential paths', () => {
    expect(eventPipelineCoreCredentialPaths).toHaveLength(49);
    expect(eventPipelineCoreCredentialPaths).toContainEqual([
      'apps/web/src/app/api/agentic/catalog/lookup/route.ts',
      'apps/web/src/lib/agentic/mutation-request.ts',
      'apps/web/src/lib/agentic/request-integrity.ts',
      'apps/web/src/env.ts',
    ]);
    expect(eventPipelineCoreCredentialPaths).toContainEqual([
      'apps/web/src/lib/payments/file-inventory-confirmation-review.ts',
      'apps/web/src/lib/supabase/admin.ts',
      'apps/web/src/env.ts',
    ]);
  });
});
