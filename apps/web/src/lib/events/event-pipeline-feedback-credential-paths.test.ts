import { describe, expect, it } from 'vitest';
import { eventPipelineFeedbackCredentialPaths } from './event-pipeline-feedback-credential-paths';

describe('eventPipelineFeedbackCredentialPaths', () => {
  it('allows only the audited feedback sender credential paths', () => {
    expect(eventPipelineFeedbackCredentialPaths).toHaveLength(4);
    expect(eventPipelineFeedbackCredentialPaths).toContainEqual([
      'apps/web/src/app/api/feedback/route.ts',
      'apps/web/src/lib/feedback/send-feedback-report-email.ts',
      'apps/web/src/lib/zeptomail.ts',
      'apps/web/src/lib/supabase/admin.ts',
      'apps/web/src/env.ts',
    ]);
    expect(eventPipelineFeedbackCredentialPaths).toContainEqual([
      'apps/web/src/lib/feedback/send-feedback-report-email.ts',
      'apps/web/src/lib/zeptomail.ts',
      'apps/web/src/env.ts',
    ]);
  });

  it('routes every path through the audited sender', () => {
    for (const path of eventPipelineFeedbackCredentialPaths) {
      expect(path).toContain(
        'apps/web/src/lib/feedback/send-feedback-report-email.ts'
      );
      expect(path.at(-1)).toBe('apps/web/src/env.ts');
    }
  });
});
