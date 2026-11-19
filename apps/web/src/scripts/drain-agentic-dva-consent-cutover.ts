import type { SupabaseClient } from '@supabase/supabase-js';
import { agenticDvaCutoverCli } from '@/lib/agentic/agentic-dva-cutover-cli';
import { agenticDvaCutoverConstants } from '@/lib/agentic/agentic-dva-cutover-constants';
import { assessAgenticDvaCutoverSession } from '@/lib/agentic/agentic-dva-cutover-evidence';
import { finalizeAgenticCheckoutPayment } from '@/lib/agentic/checkout-completion-finalize';
import { CHECKOUT_COMPLETION_IDEMPOTENCY_ROUTE } from '@/lib/agentic/checkout-completion-idempotency-route';
import { reserveAgenticIdempotencyKey } from '@/lib/agentic/idempotency';
import { logger } from '@/lib/logger';
const { emitDriftAlert, fingerprintsMatch, isPaused, parseArgs, printResult } =
  agenticDvaCutoverCli;
export async function runDrainAgenticDvaConsentCutoverCli(
  argv: string[],
  supabase: SupabaseClient,
  now = new Date()
): Promise<number> {
  if (!isPaused()) {
    console.error(
      'Agentic Paystack DVA must be paused before the cutover drain.'
    );
    return 1;
  }
  const args = parseArgs(argv);
  const serviceClient = supabase;
  const { data, error } = await serviceClient
    .from('checkout_sessions')
    .select(agenticDvaCutoverConstants.sessionSelect)
    .eq('session_id', args.sessionId)
    .maybeSingle();
  if (error || !data) {
    const errorRecord =
      error && typeof error === 'object'
        ? (error as Record<string, unknown>)
        : null;
    logger.error({
      code: 'AGENTIC_DVA_CUTOVER_SESSION_READ_FAILED',
      databaseCode:
        typeof errorRecord?.code === 'string' ? errorRecord.code : undefined,
      errorType:
        error instanceof Error
          ? error.name
          : error === null
            ? 'session_missing'
            : typeof error,
      message: 'Agentic DVA cutover drain session read failed',
      sessionId: args.sessionId,
    });
    console.error('Agentic DVA cutover drain could not read the requested session.');
    return 1;
  }

  const assessment = assessAgenticDvaCutoverSession(data, now);
  if (
    assessment.state !== args.expectedState ||
    !fingerprintsMatch(assessment.evidenceFingerprint, args.fingerprint) ||
    assessment.disposition === 'manual_review'
  ) {
    emitDriftAlert({
      actualFingerprint: assessment.evidenceFingerprint,
      actualState: assessment.state,
      expectedFingerprint: args.fingerprint,
      expectedState: args.expectedState,
      reason: assessment.reason ?? 'state_or_evidence_mismatch',
      sessionId: args.sessionId,
    });
    return 1;
  }

  const action = assessment.disposition;
  if (!args.apply) {
    printResult({
      action,
      evidenceFingerprint: assessment.evidenceFingerprint,
      mode: 'dry_run',
      sessionId: args.sessionId,
      state: args.expectedState,
    });
    return 0;
  }

  if (
    !assessment.resume ||
    !assessment.merchantId ||
    !assessment.expectedUpdatedAt ||
    !assessment.actionPayload
  ) {
    emitDriftAlert({
      actualFingerprint: assessment.evidenceFingerprint,
      actualState: assessment.state,
      expectedFingerprint: args.fingerprint,
      expectedState: args.expectedState,
      reason: 'resume_evidence_missing',
      sessionId: args.sessionId,
    });
    return 1;
  }
  const actionPayload = assessment.actionPayload.unwrap();
  const resume = assessment.resume.unwrap();
  if (
    actionPayload.currency !==
    agenticDvaCutoverConstants.supportedCurrency
  ) {
    emitDriftAlert({
      actualFingerprint: assessment.evidenceFingerprint,
      actualState: assessment.state,
      expectedFingerprint: args.fingerprint,
      expectedState: args.expectedState,
      reason: 'currency_missing_or_invalid',
      sessionId: args.sessionId,
    });
    return 1;
  }

  const idempotencyKey = `agentic-dva-cutover-${assessment.evidenceFingerprint}`;
  const requestId = `dva-cutover-${assessment.evidenceFingerprint.slice(0, 32)}`;
  const reservation = await reserveAgenticIdempotencyKey({
    apiVersion: '2026-07-20.cutover',
    body: JSON.stringify({
      evidence_fingerprint: assessment.evidenceFingerprint,
      expected_state: args.expectedState,
      session_id: args.sessionId,
    }),
    key: idempotencyKey,
    merchantId: assessment.merchantId,
    method: 'POST',
    now,
    pathname: `/internal/agentic-dva-cutover/${args.sessionId}`,
    route: CHECKOUT_COMPLETION_IDEMPOTENCY_ROUTE,
    supabase: serviceClient,
  });
  if (!reservation.ok || reservation.state !== 'reserved') {
    emitDriftAlert({
      actualFingerprint: assessment.evidenceFingerprint,
      actualState: assessment.state,
      expectedFingerprint: args.fingerprint,
      expectedState: args.expectedState,
      reason: 'idempotency_reservation_not_acquired',
      sessionId: args.sessionId,
    });
    return 1;
  }

  let response: Response;
  try {
    response = await finalizeAgenticCheckoutPayment({
      buyer: resume.buyer,
      dvaAccount: resume.dvaAccount,
      expectedSessionUpdatedAt: assessment.expectedUpdatedAt,
      finalizationClaimOverride:
        resume.finalizationClaim ?? undefined,
      idempotencyKey,
      merchantId: assessment.merchantId,
      metadata: resume.metadata,
      orderSession: {
        currency: actionPayload.currency,
        merchant_id: assessment.merchantId,
        session_id: args.sessionId,
        shipping_address: actionPayload.shippingAddress,
      },
      orderSessionCalc: {
        ...resume.sessionCalc,
        fulfillmentOptions: [],
        messages: [],
        selectedOptionId:
          typeof actionPayload.shippingMethod === 'string'
            ? actionPayload.shippingMethod
            : undefined,
      },
      requestId,
      route: CHECKOUT_COMPLETION_IDEMPOTENCY_ROUTE,
      sessionId: args.sessionId,
      supabase: serviceClient,
    });
  } catch (error) {
    emitDriftAlert({
      actualFingerprint: assessment.evidenceFingerprint,
      actualState: assessment.state,
      expectedFingerprint: args.fingerprint,
      expectedState: args.expectedState,
      finalizerErrorType: error instanceof Error ? error.name : typeof error,
      reason: 'finalizer_threw',
      sessionId: args.sessionId,
    });
    return 1;
  }
  printResult({
    action,
    evidenceFingerprint: assessment.evidenceFingerprint,
    mode: 'apply',
    sessionId: args.sessionId,
    state: args.expectedState,
    status: response.status,
  });
  return response.status === 200 ? 0 : 1;
}
