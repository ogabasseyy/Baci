import 'server-only';
import type { createServiceClient } from '@/lib/supabase/service';
import {
  journeyContextSchema,
  onboardingJobSchema,
} from '@/schemas/merchant-onboarding-email';
import type { JourneyRepository } from './worker';

// Internal worker only. No caller session, HTTP endpoint, or frontend import.
export function createJourneyRepository(
  client: ReturnType<typeof createServiceClient>
): JourneyRepository {
  return {
    async claim() {
      const { data, error } = await client.rpc(
        'claim_merchant_onboarding_email_jobs',
        { p_limit: 20 }
      );
      if (error) throw new Error('Could not claim onboarding jobs');
      return onboardingJobSchema.array().parse(data);
    },
    async context(merchantId) {
      const { data, error } = await client.rpc(
        'get_merchant_onboarding_email_context',
        { p_merchant_id: merchantId }
      );
      if (error) throw new Error('Could not read onboarding context');
      return data === null ? null : journeyContextSchema.parse(data);
    },
    async beginDispatch(job, email) {
      const { data, error } = await client.rpc(
        'begin_merchant_onboarding_email_dispatch',
        {
          p_id: job.id,
          p_claim_token: job.claim_token,
          p_expected_email: email,
        }
      );
      if (error) throw new Error('Could not begin onboarding dispatch');
      return data === true;
    },
    async finish(job, status, code, messageId) {
      const { data, error } = await client
        .from('merchant_onboarding_email_jobs')
        .update({
          status,
          outcome_code: code,
          provider_message_id: messageId ?? null,
          ...(status === 'pending'
            ? { due_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() }
            : {}),
          claim_token: null,
        })
        .eq('id', job.id)
        .eq('claim_token', job.claim_token)
        .in('status', ['processing', 'dispatching'])
        .select('id');
      if (error || !data?.length)
        throw new Error('Could not record onboarding outcome');
    },
  };
}
