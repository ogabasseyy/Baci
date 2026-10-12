import { describe, expect, it } from 'vitest';
import { eventPipelinePaystackRefundCredentialPaths } from './event-pipeline-paystack-refund-credential-paths';

describe('Paystack refund push authority', () => {
  it('limits the exception to the cancellation cron and Expo push helper', () => {
    expect(eventPipelinePaystackRefundCredentialPaths).toEqual([
      [
        'apps/web/src/app/api/cron/process-settlements/route.ts',
        'apps/web/src/lib/expo-push.ts',
        'apps/web/src/env.ts',
      ],
      [
        'apps/web/src/app/api/cron/process-settlements/route.ts',
        'apps/web/src/lib/expo-push.ts',
        'apps/web/src/lib/supabase/admin.ts',
        'apps/web/src/env.ts',
      ],
    ]);
  });
});
