import { type NextRequest, NextResponse } from 'next/server';
import {
  QuizAppAttestationError,
  quizAppAttestationErrorResponse,
} from '@/app/api/quiz/_shared/quiz-app-attestation-error';
import {
  QuizAppOnlyError,
  quizAppOnlyErrorResponse,
} from '@/app/api/quiz/_shared/quiz-app-only-error';
import {
  readQuizDeviceFingerprint,
  requireQuizV2Contract,
  requireQuizV2Runtime,
} from '@/app/api/quiz/_shared/quiz-v2-contract';
import {
  invalidInputResponse,
  isQuizAgeGateError,
  parseJsonBody,
  prizeGuardErrorResponse,
  quizAgeGateErrorResponse,
  quizRpcClientErrorResponse,
  rejectQuizIdentityMismatch,
  requireQuizCsrf,
  requireQuizUser,
  rpcErrorResponse,
} from '@/app/api/quiz/_shared/route-helpers';
import { enforceQuizStartGuards } from '@/app/api/quiz/attempts/start/v2-start-guards';
import { getQuizEdgeWorkerUrl, getQuizTicketSecret } from '@/env';
import { logger } from '@/lib/logger';
import { resolveQuizDevice } from '@/lib/quiz/quiz-device-hash';
import { signQuizEdgeAdmissionTicket } from '@/lib/quiz/quiz-edge-ticket';
import { QuizProductionNotApprovedError } from '@/lib/quiz-compliance-gate';
import {
  quizEdgeAdmissionRpcResultSchema,
  quizEdgeCheckInParamsSchema,
  quizEdgeCheckInRequestSchema,
} from '@/schemas/quiz-edge-check-in';

const APP_CHECK_HEADER = 'X-Firebase-AppCheck';
const CHALLENGE_HEADER = 'X-Baci-Quiz-Attestation-Nonce';
const TICKET_GRACE_MS = 60_000;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ eventId: string }> }
) {
  const auth = await requireQuizUser(request, { requireFreshSession: true });
  if (auth.response) return auth.response;

  const csrfResponse = await requireQuizCsrf(request);
  if (csrfResponse) return csrfResponse;
  const contractResponse = requireQuizV2Contract(request);
  if (contractResponse) return contractResponse;

  const parsedParams = quizEdgeCheckInParamsSchema.safeParse(
    await context.params
  );
  if (!parsedParams.success) {
    return invalidInputResponse(parsedParams.error.flatten().fieldErrors);
  }
  const { eventId } = parsedParams.data;

  const { body, response } = await parseJsonBody(request);
  if (response) return response;
  const parsedBody = quizEdgeCheckInRequestSchema.safeParse(body);
  if (!parsedBody.success) {
    return invalidInputResponse(parsedBody.error.flatten().fieldErrors);
  }

  const mismatch = rejectQuizIdentityMismatch(
    parsedBody.data.expectedUserId,
    auth.user.id
  );
  if (mismatch) return mismatch;

  const edgeBaseUrl = getQuizEdgeWorkerUrl();
  const ticketSecret = getQuizTicketSecret();
  if (!edgeBaseUrl || !ticketSecret) {
    return NextResponse.json(
      {
        error: 'Quiz edge rooms are not configured',
        code: 'QUIZ_EDGE_NOT_CONFIGURED',
      },
      { status: 503 }
    );
  }

  const rawFingerprint = request.headers.get('X-Baci-Quiz-Device-Fingerprint');
  const fingerprint = readQuizDeviceFingerprint(request);
  if (rawFingerprint !== null && !fingerprint) {
    return invalidInputResponse({ deviceFingerprint: ['Invalid header'] });
  }

  const runtimeResponse = await requireQuizV2Runtime(auth.supabase);
  if (runtimeResponse) return runtimeResponse;

  try {
    await enforceQuizStartGuards(
      auth.supabase,
      eventId,
      auth.user.id,
      auth.authMethod,
      request.headers.get(APP_CHECK_HEADER)?.trim() || null,
      request.headers.get(CHALLENGE_HEADER)?.trim() || null
    );
  } catch (error) {
    if (error instanceof QuizAppAttestationError) {
      return quizAppAttestationErrorResponse(error);
    }
    if (error instanceof QuizAppOnlyError) {
      return quizAppOnlyErrorResponse(error);
    }
    if (isQuizAgeGateError(error)) return quizAgeGateErrorResponse(error);
    if (error instanceof QuizProductionNotApprovedError) {
      return prizeGuardErrorResponse(error);
    }
    return rpcErrorResponse();
  }

  const device = resolveQuizDevice(request, fingerprint ?? undefined);
  const deviceHash = device.deviceHash;
  if (!deviceHash) {
    return invalidInputResponse({
      deviceFingerprint: ['Device identity is required'],
    });
  }
  const withCookie = (result: NextResponse) => {
    if ('cookieToSet' in device && device.cookieToSet) {
      result.cookies.set(device.cookieToSet);
    }
    return result;
  };

  const { data, error } = await auth.supabase.rpc('check_in_quiz_event_v2', {
    p_event_id: eventId,
    p_device_hash: deviceHash,
    p_accepted_rules_version: parsedBody.data.acceptedRulesVersion,
    p_terms_accepted: parsedBody.data.termsAccepted,
    p_check_in_request_id: parsedBody.data.checkInRequestId,
    p_app_version: parsedBody.data.appVersion,
    p_platform: parsedBody.data.platform,
    p_integrity_tier: parsedBody.data.integrityTier,
  });

  if (error) {
    return withCookie(quizRpcClientErrorResponse(error) ?? rpcErrorResponse());
  }

  const parsedAdmission = quizEdgeAdmissionRpcResultSchema.safeParse(data);
  if (!parsedAdmission.success) {
    logger.error({
      event: 'check_in_quiz_event_v2_invalid_projection',
      issues: parsedAdmission.error.issues,
      message: 'check_in_quiz_event_v2 returned an invalid projection',
      eventId,
      userId: auth.user.id,
    });
    return withCookie(rpcErrorResponse());
  }

  const admission = parsedAdmission.data;
  const endsAtMs = Date.parse(admission.endsAt);
  const ticket = signQuizEdgeAdmissionTicket(
    {
      userId: admission.userId,
      customerId: admission.customerId,
      merchantId: admission.merchantId,
      eventId: admission.eventId,
      roomId: admission.roomId,
      admissionId: admission.admissionId,
      deviceHash,
      leaderboardUsername: admission.leaderboardUsername,
      expiresAtMs:
        (Number.isFinite(endsAtMs) ? endsAtMs : Date.now() + 3_600_000) +
        TICKET_GRACE_MS,
      mode: admission.mode,
    },
    ticketSecret
  );

  return withCookie(
    NextResponse.json(
      {
        admissionId: admission.admissionId,
        eventId: admission.eventId,
        merchantId: admission.merchantId,
        roomId: admission.roomId,
        roomIndex: admission.roomIndex,
        leaderboardUsername: admission.leaderboardUsername,
        maxAttempts: admission.maxAttempts,
        startsAt: admission.startsAt,
        endsAt: admission.endsAt,
        rulesVersion: admission.rulesVersion,
        reused: admission.reused,
        backendMode: 'edge_rooms' as const,
        edgeBaseUrl,
        ticket,
      },
      { status: 200 }
    )
  );
}
