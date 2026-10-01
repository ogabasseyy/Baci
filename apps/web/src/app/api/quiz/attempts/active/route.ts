import { type NextRequest, NextResponse } from 'next/server';
import { enrichQuizV2ActiveResponseWithSubmissionTime } from '@/app/api/quiz/_shared/quiz-v2-attempt-submission';
import {
  readQuizDeviceFingerprint,
  requireQuizV2Contract,
  requireQuizV2Runtime,
} from '@/app/api/quiz/_shared/quiz-v2-contract';
import { parseQuizV2ActiveAttempt } from '@/app/api/quiz/_shared/quiz-v2-projection';
import {
  invalidInputResponse,
  quizRpcClientErrorResponse,
  requireQuizUser,
  rpcErrorResponse,
} from '@/app/api/quiz/_shared/route-auth';
import { logger } from '@/lib/logger';
import { resolveQuizDevice } from '@/lib/quiz/quiz-device-hash';
import { quizActiveAttemptQuerySchema } from '@/schemas/quiz';

export async function GET(request: NextRequest) {
  const auth = await requireQuizUser(request);
  if (auth.response) return auth.response;

  const contractResponse = requireQuizV2Contract(request);
  if (contractResponse) return contractResponse;
  const parsed = quizActiveAttemptQuerySchema.safeParse({
    eventId: request.nextUrl.searchParams.get('eventId') ?? undefined,
  });
  if (!parsed.success) {
    return invalidInputResponse(parsed.error.flatten().fieldErrors);
  }

  const runtimeResponse = await requireQuizV2Runtime(auth.supabase);
  if (runtimeResponse) return runtimeResponse;
  const rawFingerprint = request.headers.get('X-Baci-Quiz-Device-Fingerprint');
  const fingerprint = readQuizDeviceFingerprint(request);
  if (rawFingerprint !== null && !fingerprint) {
    return invalidInputResponse({ deviceFingerprint: ['Invalid header'] });
  }
  const device =
    auth.authMethod === 'cookie' || fingerprint
      ? resolveQuizDevice(request, fingerprint ?? undefined)
      : { deviceHash: null };

  const { data, error } = await auth.supabase.rpc('resume_quiz_attempt_v2', {
    p_device_hash: device.deviceHash ?? undefined,
    p_event_id: parsed.data.eventId,
  });
  if (error) {
    const clientResponse = quizRpcClientErrorResponse(error);
    if (clientResponse) return clientResponse;
    logger.error({
      event: 'resume_quiz_attempt_v2_failed',
      eventId: parsed.data.eventId,
      message: 'resume_quiz_attempt_v2 RPC failed',
      userId: auth.user.id,
    });
    return rpcErrorResponse();
  }

  const enriched = await enrichQuizV2ActiveResponseWithSubmissionTime(
    auth.supabase,
    data
  );
  if (enriched.error) {
    logger.error({
      event: 'resume_quiz_attempt_v2_submission_time_failed',
      eventId: parsed.data.eventId,
      message: 'Could not read the authoritative quiz submission time',
      userId: auth.user.id,
    });
    return rpcErrorResponse();
  }
  const projection = parseQuizV2ActiveAttempt(enriched.response);
  if (!projection.success) {
    logger.error({
      event: 'resume_quiz_attempt_v2_invalid_projection',
      eventId: parsed.data.eventId,
      issues: projection.error.issues,
      message: 'resume_quiz_attempt_v2 returned an invalid projection',
      userId: auth.user.id,
    });
    return rpcErrorResponse();
  }
  const response = NextResponse.json(projection.data);
  if ('cookieToSet' in device && device.cookieToSet) {
    response.cookies.set(device.cookieToSet);
  }
  return response;
}
