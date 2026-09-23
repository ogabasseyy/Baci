import { type NextRequest, NextResponse } from 'next/server';
import { enrichQuizV2AttemptWithSubmissionTime } from '@/app/api/quiz/_shared/quiz-v2-attempt-submission';
import {
  readQuizDeviceFingerprint,
  requireQuizV2Contract,
  requireQuizV2Runtime,
} from '@/app/api/quiz/_shared/quiz-v2-contract';
import { parseQuizV2Attempt } from '@/app/api/quiz/_shared/quiz-v2-projection';
import {
  createRouteProof,
  invalidInputResponse,
  parseJsonBody,
  quizRpcClientErrorResponse,
  rejectQuizIdentityMismatch,
  requireQuizCsrf,
  requireQuizUser,
  rpcErrorResponse,
} from '@/app/api/quiz/_shared/route-helpers';
import { logger } from '@/lib/logger';
import {
  QUIZ_DEVICE_COOKIE,
  resolveQuizDevice,
} from '@/lib/quiz/quiz-device-hash';
import { buildQuizDeviceProofSubject } from '@/lib/quiz/quiz-device-proof-subject';
import { startQuizAttemptV2RouteSchema } from '@/schemas/quiz';

const START_ACTION = 'start_quiz_attempt_v2';
const DEVICE_ACTION = 'start_quiz_attempt_with_device_v2';

export async function postQuizStartV2(request: NextRequest) {
  const auth = await requireQuizUser(request);
  if (auth.response) return auth.response;

  const csrfResponse = await requireQuizCsrf(request);
  if (csrfResponse) return csrfResponse;
  const contractResponse = requireQuizV2Contract(request);
  if (contractResponse) return contractResponse;

  const { body, response } = await parseJsonBody(request);
  if (response) return response;
  const parsed = startQuizAttemptV2RouteSchema.safeParse(body);
  if (!parsed.success) {
    return invalidInputResponse(parsed.error.flatten().fieldErrors);
  }
  const mismatch = rejectQuizIdentityMismatch(
    parsed.data.expectedUserId,
    auth.user.id
  );
  if (mismatch) return mismatch;

  const runtimeResponse = await requireQuizV2Runtime(auth.supabase);
  if (runtimeResponse) return runtimeResponse;

  const rawFingerprint = request.headers.get('X-Baci-Quiz-Device-Fingerprint');
  const fingerprint = readQuizDeviceFingerprint(request);
  if (rawFingerprint !== null && !fingerprint) {
    return invalidInputResponse({ deviceFingerprint: ['Invalid header'] });
  }

  const shouldResolveDevice =
    auth.authMethod === 'cookie' ||
    Boolean(fingerprint) ||
    Boolean(request.cookies.get(QUIZ_DEVICE_COOKIE)?.value?.trim());
  const device = shouldResolveDevice
    ? resolveQuizDevice(request, fingerprint ?? undefined)
    : { deviceHash: null };
  const withCookie = (result: NextResponse) => {
    if ('cookieToSet' in device && device.cookieToSet) {
      result.cookies.set(device.cookieToSet);
    }
    return result;
  };

  const startSubject = `${parsed.data.eventId}:${parsed.data.startRequestId}`;
  const startPayload = {
    accepted_rules_version: parsed.data.acceptedRulesVersion,
    app_version: parsed.data.appVersion,
    event_id: parsed.data.eventId,
    integrity_tier: parsed.data.integrityTier,
    platform: parsed.data.platform,
    start_request_id: parsed.data.startRequestId,
    terms_accepted: parsed.data.termsAccepted,
    user_id: auth.user.id,
  };
  const startProof = createRouteProof({
    action: START_ACTION,
    payload: startPayload,
    subjectId: startSubject,
    userId: auth.user.id,
  });
  if (startProof.response) return withCookie(startProof.response);

  let deviceProof: unknown;
  if (device.deviceHash) {
    const proof = createRouteProof({
      action: DEVICE_ACTION,
      payload: {
        device_hash: device.deviceHash,
        event_id: parsed.data.eventId,
        user_id: auth.user.id,
      },
      subjectId: buildQuizDeviceProofSubject(
        parsed.data.eventId,
        device.deviceHash
      ),
      userId: auth.user.id,
    });
    if (proof.response) return withCookie(proof.response);
    deviceProof = proof.proof;
  }

  const commonArgs = {
    p_accepted_rules_version: parsed.data.acceptedRulesVersion,
    p_app_version: parsed.data.appVersion,
    p_event_id: parsed.data.eventId,
    p_integrity_tier: parsed.data.integrityTier,
    p_platform: parsed.data.platform,
    p_start_request_id: parsed.data.startRequestId,
    p_terms_accepted: parsed.data.termsAccepted,
    p_user_id: auth.user.id,
  };
  const { data, error } = device.deviceHash
    ? await auth.supabase.rpc('start_quiz_attempt_with_device_v2', {
        ...commonArgs,
        p_device_hash: device.deviceHash,
        p_device_route_proof: deviceProof,
        p_start_route_proof: startProof.proof,
      })
    : await auth.supabase.rpc('start_quiz_attempt_v2', {
        ...commonArgs,
        p_route_proof: startProof.proof,
      });

  if (error) {
    const clientResponse = quizRpcClientErrorResponse(error);
    if (clientResponse) return withCookie(clientResponse);
    logger.error({
      event: 'start_quiz_attempt_v2_failed',
      eventId: parsed.data.eventId,
      message: 'start_quiz_attempt_v2 RPC failed',
      userId: auth.user.id,
    });
    return withCookie(rpcErrorResponse());
  }

  const enriched = await enrichQuizV2AttemptWithSubmissionTime(
    auth.supabase,
    data
  );
  if (enriched.error) {
    logger.error({
      event: 'start_quiz_attempt_v2_submission_time_failed',
      eventId: parsed.data.eventId,
      message: 'Could not read the authoritative quiz submission time',
      userId: auth.user.id,
    });
    return withCookie(rpcErrorResponse());
  }
  const result = parseQuizV2Attempt(enriched.attempt);
  if (!result.success) {
    logger.error({
      event: 'start_quiz_attempt_v2_invalid_projection',
      eventId: parsed.data.eventId,
      issues: result.error.issues,
      message: 'start_quiz_attempt_v2 returned an invalid projection',
      userId: auth.user.id,
    });
    return withCookie(rpcErrorResponse());
  }
  return withCookie(NextResponse.json(result.data));
}
