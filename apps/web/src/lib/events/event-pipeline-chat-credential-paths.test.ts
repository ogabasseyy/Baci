import { describe, expect, it } from 'vitest';
import { eventPipelineChatCredentialPaths } from './event-pipeline-chat-credential-paths';

describe('eventPipelineChatCredentialPaths', () => {
  it('allows only the audited consolidated chat credential paths', () => {
    expect(eventPipelineChatCredentialPaths).toHaveLength(10);
    expect(eventPipelineChatCredentialPaths).toContainEqual([
      'apps/web/src/lib/agentic/agentic-chat-tenant.ts',
      'apps/web/src/lib/storefront-merchant.ts',
      'apps/web/src/lib/get-merchant-by-identifier-or-alias.ts',
      'apps/web/src/lib/cached-data.ts',
      'apps/web/src/env.ts',
    ]);
    expect(eventPipelineChatCredentialPaths).toContainEqual([
      'apps/web/src/app/api/chat/santa/santa-analytics.ts',
      'apps/web/src/lib/agentic/scoped-supabase.ts',
      'apps/web/src/lib/supabase/scoped-jwt.ts',
      'apps/web/src/lib/agentic/jwt-signing-material.ts',
      'apps/web/src/env.ts',
    ]);
  });
});
