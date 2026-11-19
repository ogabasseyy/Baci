import type { sendEmail } from '@/lib/zeptomail';
import type {
  JourneyContext,
  OnboardingJob,
} from '@/schemas/merchant-onboarding-email';
import { toOnboardingContext } from './context';
import { decideOnboardingEmail } from './policy';
import { buildOnboardingEmail } from './template';
export type JobOutcome = 'pending' | 'accepted' | 'skipped' | 'unknown';
export interface JourneyRepository {
  claim(): Promise<OnboardingJob[]>;
  context(merchantId: string): Promise<JourneyContext | null>;
  beginDispatch(job: OnboardingJob, email: string): Promise<boolean>;
  finish(
    job: OnboardingJob,
    status: JobOutcome,
    code: string,
    messageId?: string
  ): Promise<void>;
}
export async function processOnboardingEmailBatch(
  repo: JourneyRepository,
  send: typeof sendEmail,
  appUrl: string
) {
  const jobs = await repo.claim();
  const counts = { processed: jobs.length, accepted: 0, unknown: 0, failed: 0 };
  for (const job of jobs) {
    let dispatched = false;
    let cancellation: { status: JobOutcome; code: string } | undefined;
    try {
      const context = await repo.context(job.merchant_id);
      if (!context) {
        await repo.finish(job, 'skipped', 'ineligible');
        continue;
      }
      const decision = decideOnboardingEmail(
        job.stage,
        toOnboardingContext(context)
      );
      if (decision.kind !== 'send') {
        await repo.finish(
          job,
          decision.kind === 'defer' ? 'pending' : 'skipped',
          decision.kind === 'defer'
            ? 'waiting_for_setup'
            : 'completed_or_opted_out'
        );
        continue;
      }
      if (!context.reply_to)
        throw new Error('Monitored support Reply-To is required');
      const optOutUrl = new URL('/onboarding/email-preferences', appUrl);
      optOutUrl.searchParams.set('token', context.opt_out_token);
      const content = buildOnboardingEmail({
        businessName: context.business_name,
        decision,
        stage: job.stage,
        appUrl,
        optOutUrl: optOutUrl.toString(),
      });
      const result = await send({
        ...content,
        to: context.email,
        toName: context.business_name,
        emailType: 'welcome',
        fromName: 'Baci',
        replyTo: context.reply_to,
        maxAttemptsPerSender: 1,
        // Platform onboarding must not resolve a merchant's custom sending domain.
        // The platform audit is linked to the durable merchant job in metadata.
        auditContext: {
          metadata: {
            merchantId: job.merchant_id,
            sequenceId: 'merchant-onboarding-v1',
            stage: job.stage,
            jobId: job.id,
          },
        },
        clientReference: `merchant-onboarding:${job.id}`,
        beforeTransportDispatch: async () => {
          const fresh = await repo.context(job.merchant_id);
          const next = fresh
            ? decideOnboardingEmail(job.stage, toOnboardingContext(fresh))
            : null;
          if (
            !fresh ||
            next?.kind !== 'send' ||
            fresh.email !== context.email ||
            fresh.reply_to !== context.reply_to ||
            next.action !== decision.action ||
            next.href !== decision.href
          ) {
            cancellation = {
              status: next?.kind === 'defer' ? 'pending' : 'skipped',
              code: 'state_changed',
            };
            throw new Error('Onboarding state changed');
          }
          if (!(await repo.beginDispatch(job, context.email))) {
            cancellation = { status: 'pending', code: 'dispatch_not_admitted' };
            throw new Error('Dispatch not admitted');
          }
          dispatched = true;
        },
      });
      if (cancellation) {
        await repo.finish(job, cancellation.status, cancellation.code);
        continue;
      }
      if (result.success) {
        await repo.finish(
          job,
          'accepted',
          'provider_accepted',
          result.messageId
        );
        counts.accepted++;
      } else {
        const uncertain = result.deliveryOutcome === 'unknown';
        await repo.finish(
          job,
          uncertain ? 'unknown' : 'pending',
          uncertain
            ? 'reconcile_provider_outcome'
            : dispatched
              ? 'provider_rejected'
              : 'transport_not_started'
        );
        if (uncertain) counts.unknown++;
        else counts.failed++;
      }
    } catch {
      if (cancellation) {
        await repo.finish(job, cancellation.status, cancellation.code);
      } else {
        await repo.finish(
          job,
          dispatched ? 'unknown' : 'pending',
          dispatched ? 'reconcile_provider_outcome' : 'pre_dispatch_failure'
        );
        if (dispatched) counts.unknown++;
        else counts.failed++;
      }
    }
  }
  return counts;
}
