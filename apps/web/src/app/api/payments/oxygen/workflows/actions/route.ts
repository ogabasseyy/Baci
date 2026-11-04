import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  oxygenActiveLoanCode,
  oxygenActiveLoanMessage,
  oxygenStatementRequiredCode,
  oxygenStatementRequiredMessage,
} from '@/lib/payments/oxygen/booking-rejection';
import { readOxygenNinRetryStatus } from '@/lib/payments/oxygen/nin-retry-status';
import {
  oxygenInvalidOtpCode,
  oxygenInvalidOtpMessage,
} from '@/lib/payments/oxygen/otp-rejection';
import { confirmOxygenPaymentForActivation } from '@/lib/payments/oxygen/payment-activation-confirmation';
import {
  OxygenPaymentOriginUnverifiedError,
  oxygenPaymentOriginCode,
  oxygenPaymentOriginMessage,
} from '@/lib/payments/oxygen/payment-origin-error';
import { performOxygenPaymentRecovery } from '@/lib/payments/oxygen/payment-recovery';
import { OxygenProviderFailure } from '@/lib/payments/oxygen/provider';
import { restoreOxygenEligibilityRecovery } from '@/lib/payments/oxygen/restore-eligibility-recovery';
import { connectOxygenRuntime } from '@/lib/payments/oxygen/runtime-connection';
import { readOxygenRuntimeRequest } from '@/lib/payments/oxygen/runtime-request';
import {
  performOxygenAction,
  readOxygenSnapshot,
} from '@/lib/payments/oxygen/runtime-service';
import { checkOxygenProviderRateLimit } from '@/lib/rate-limit';
import { oxygenPlanQuoteSchema } from '@/schemas/oxygen-plan-quote';

// Payment confirmation can lead to a staging activation with additional
// provider calls; keep time to persist its outcome before termination.
export const maxDuration = 300;
const headers = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers }
    );
  const id = z.uuid().safeParse(request.nextUrl.searchParams.get('workflowId'));
  if (!id.success)
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400, headers }
    );
  try {
    const owned = await readOxygenSnapshot(auth.supabase, id.data);
    const connection = connectOxygenRuntime();
    const snapshot = connection
      ? await restoreOxygenEligibilityRecovery(owned, connection.worker)
      : owned;
    let pending = snapshot.pending;
    if (pending?.action === 'book' && pending.status === 'queued') {
      const terms = await auth.supabase.rpc('oxygen_queued_booking_terms', {
        p_workflow_id: snapshot.workflowId,
        p_version: snapshot.version,
        p_key: pending.idempotencyKey,
      });
      if (terms.error) throw new Error('Workflow unavailable');
      if (terms.data)
        pending = {
          ...pending,
          bookingTerms: oxygenPlanQuoteSchema
            .pick({ equityPercentage: true, tenure: true })
            .parse(terms.data),
        };
    }
    return NextResponse.json(
      {
        ...snapshot,
        pending,
        ninAttemptStatus: await readOxygenNinRetryStatus(
          auth.supabase,
          snapshot
        ),
        executionEnabled: snapshot.executionEnabled && Boolean(connection),
      },
      { headers }
    );
  } catch {
    return NextResponse.json(
      { error: 'Workflow unavailable' },
      { status: 404, headers }
    );
  }
}
export async function POST(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers }
    );
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid)
    return (
      csrf.response ??
      NextResponse.json({ error: 'Invalid request' }, { status: 403, headers })
    );
  if (
    !(await checkOxygenProviderRateLimit(auth.user.id, 'request', 30)).allowed
  )
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers }
    );
  let input: Awaited<ReturnType<typeof readOxygenRuntimeRequest>>;
  try {
    input = await readOxygenRuntimeRequest(request);
  } catch {
    return NextResponse.json(
      { error: 'Invalid workflow request' },
      { status: 400, headers }
    );
  }
  // Background lookups must not consume the same six-call budget as OTPs.
  // Admission is bounded above; each validated operation retains its own limit.
  if (
    !(
      await checkOxygenProviderRateLimit(
        auth.user.id,
        `action:${input.submission.command.action}`,
        6
      )
    ).allowed
  )
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers }
    );
  const connection = connectOxygenRuntime();
  if (!connection)
    return NextResponse.json(
      { error: 'Provider connection unavailable' },
      { status: 503, headers }
    );
  const userClient = auth.supabase;
  try {
    let snapshot = await performOxygenAction(
      userClient,
      connection.worker,
      connection.provider,
      connection.partnerReference,
      connection.hosts,
      input.submission,
      input.file
    );
    if (
      input.submission.command.action === 'refresh_payment_setup' &&
      snapshot.state.paymentComplete &&
      snapshot.state.setupComplete
    ) {
      const confirmed = await confirmOxygenPaymentForActivation(
        snapshot,
        (request) =>
          performOxygenPaymentRecovery(
            userClient,
            connection.worker,
            connection.recoveryProvider,
            connection.hosts,
            request,
            connection.recoveryRecorder
          )
      );
      if (confirmed)
        await connection.completePaidActivation(
          await connection.worker(),
          input.submission.workflowId
        );
      snapshot = await readOxygenSnapshot(
        userClient,
        input.submission.workflowId
      );
    }
    return NextResponse.json(
      {
        ...snapshot,
        ninAttemptStatus: await readOxygenNinRetryStatus(userClient, snapshot),
      },
      { headers }
    );
  } catch (failure) {
    if (failure instanceof OxygenPaymentOriginUnverifiedError)
      return NextResponse.json(
        { code: oxygenPaymentOriginCode, error: oxygenPaymentOriginMessage },
        { status: 409, headers }
      );
    if (
      input.submission.command.action === 'validate_customer' &&
      failure instanceof OxygenProviderFailure &&
      failure.outcome === 'rejected' &&
      failure.code === oxygenInvalidOtpCode
    )
      return NextResponse.json(
        { error: oxygenInvalidOtpMessage, code: oxygenInvalidOtpCode },
        { status: 409, headers }
      );
    if (
      failure instanceof OxygenProviderFailure &&
      failure.code === oxygenStatementRequiredCode
    )
      return NextResponse.json(
        {
          error: oxygenStatementRequiredMessage,
          code: oxygenStatementRequiredCode,
        },
        { status: 409, headers }
      );
    if (
      failure instanceof OxygenProviderFailure &&
      failure.outcome === 'rejected' &&
      failure.code === oxygenActiveLoanCode
    )
      return NextResponse.json(
        { error: oxygenActiveLoanMessage, code: oxygenActiveLoanCode },
        { status: 409, headers }
      );
    // Do not echo provider payloads, tokens, documents, OTPs or private DB errors.
    return NextResponse.json(
      {
        error:
          'Unable to confirm this step. Refresh the saved status before continuing.',
      },
      { status: 409, headers }
    );
  }
}
