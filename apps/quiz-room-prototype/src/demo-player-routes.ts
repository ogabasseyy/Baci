import { type QuizAdmissionTicket, QuizRoomError } from './contracts';
import { constantTimeEqualStrings } from './crypto';
import {
  classifyVerifiedNetwork,
  isSelfReportMismatch,
  normalizeSelfReportedCarrier,
} from './demo-isp';
import type { DemoDispatchEnv } from './demo-routes';
import type { DemoRoundState, DemoTelemetryInput } from './demo-state';
import {
  requireConfiguredSecret,
  signAdmissionTicket,
  signBearerJwt,
  verifyAdmissionTicket,
} from './ticket';

export async function parseJsonObject(
  request: Request
): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw new QuizRoomError('QUIZ_INVALID_JSON', 'Malformed JSON body', 400);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new QuizRoomError(
      'QUIZ_INVALID_JSON',
      'Request body must be a JSON object',
      400
    );
  }
  return parsed as Record<string, unknown>;
}

export async function handleDemoCheckIn(
  request: Request,
  url: URL,
  env: DemoDispatchEnv
): Promise<Response> {
  const expectedInvite = requireConfiguredSecret(
    env.QUIZ_DEMO_INVITE_CODE,
    'QUIZ_DEMO_INVITE_CODE'
  ).trim();
  const ticketSecret = requireConfiguredSecret(
    env.QUIZ_TICKET_SECRET,
    'QUIZ_TICKET_SECRET'
  );
  const jwtSecret = requireConfiguredSecret(
    env.QUIZ_JWT_SECRET,
    'QUIZ_JWT_SECRET'
  );
  const body = (await parseJsonObject(request)) as {
    carrier?: string;
    nickname?: string;
    roomId?: string;
    inviteCode?: string;
  };
  const providedInvite = (
    typeof body.inviteCode === 'string' && body.inviteCode.trim()
      ? body.inviteCode
      : (url.searchParams.get('code') ?? '')
  ).trim();
  if (
    !providedInvite ||
    !constantTimeEqualStrings(providedInvite, expectedInvite)
  ) {
    throw new QuizRoomError(
      'QUIZ_INVITE_REQUIRED',
      'Valid invite code is required',
      403
    );
  }

  const netInfo = classifyVerifiedNetwork(request);
  const selfReportedCarrier = normalizeSelfReportedCarrier(body.carrier);
  const networkMismatch = isSelfReportMismatch(selfReportedCarrier, netInfo);

  const allocRes = await env.callDemoDo('/internal/demo/check-in', {
    roomId: body.roomId,
  });
  if (!allocRes.ok) return allocRes;
  const alloc = (await allocRes.json()) as {
    round: DemoRoundState;
    roomId: string;
    playerSeq: number;
  };
  await env.refreshControlState(alloc.round.eventId, Date.now());
  const userId = `demo-u-${alloc.round.round}-${alloc.playerSeq}`;
  const customerId = `demo-c-${alloc.round.round}-${alloc.playerSeq}`;
  const deviceHash = String(alloc.playerSeq).padStart(64, '0');
  const nickname = (body.nickname ?? `Player-${alloc.playerSeq}`).trim();
  const ticket: QuizAdmissionTicket = {
    userId,
    customerId,
    merchantId: alloc.round.merchantId,
    eventId: alloc.round.eventId,
    roomId: alloc.roomId,
    deviceHash,
    leaderboardUsername: nickname,
    expiresAtMs: alloc.round.endsAtMs + 60_000,
    mode: 'live',
  };
  const [signedTicket, bearerToken] = await Promise.all([
    signAdmissionTicket(ticket, ticketSecret),
    signBearerJwt(
      {
        sub: userId,
        merchantId: alloc.round.merchantId,
        customerId,
        exp: Math.floor((alloc.round.endsAtMs + 3_600_000) / 1000),
      },
      jwtSecret
    ),
  ]);
  return new Response(
    JSON.stringify({
      round: alloc.round.round,
      eventId: alloc.round.eventId,
      roomId: alloc.roomId,
      startsAtMs: alloc.round.startsAtMs,
      endsAtMs: alloc.round.endsAtMs,
      soloInstantResult: Boolean(alloc.round.soloInstantResult),
      nickname,
      carrier: selfReportedCarrier,
      verifiedNetwork: netInfo.verifiedNetwork,
      asn: netInfo.asn,
      asOrganization: netInfo.asOrganization,
      colo: netInfo.colo,
      country: netInfo.country,
      networkMismatch,
      ticket: signedTicket,
      bearerToken,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    }
  );
}

export async function handleDemoTelemetry(
  request: Request,
  env: DemoDispatchEnv
): Promise<Response> {
  const ticketSecret = requireConfiguredSecret(
    env.QUIZ_TICKET_SECRET,
    'QUIZ_TICKET_SECRET'
  );
  const body = await parseJsonObject(request);
  const eventId = typeof body.eventId === 'string' ? body.eventId.trim() : '';
  const attemptId =
    typeof body.attemptId === 'string' ? body.attemptId.trim() : '';
  const questionIndex = body.questionIndex;
  const tapToAckMs = body.tapToAckMs;
  if (!eventId || !attemptId) {
    throw new QuizRoomError(
      'QUIZ_INVALID_TELEMETRY',
      'eventId and attemptId are required',
      400
    );
  }
  if (
    typeof questionIndex !== 'number' ||
    !Number.isInteger(questionIndex) ||
    questionIndex < 1 ||
    questionIndex > 10
  ) {
    throw new QuizRoomError(
      'QUIZ_INVALID_TELEMETRY',
      'questionIndex must be an integer between 1 and 10',
      400
    );
  }
  if (
    typeof tapToAckMs !== 'number' ||
    !Number.isFinite(tapToAckMs) ||
    tapToAckMs < 1 ||
    tapToAckMs > 60_000
  ) {
    throw new QuizRoomError(
      'QUIZ_INVALID_TELEMETRY',
      'tapToAckMs must be between 1 and 60000 ms',
      400
    );
  }
  const ticketHeader = request.headers.get('X-Baci-Quiz-Ticket') ?? '';
  const ticket = await verifyAdmissionTicket(ticketHeader, {
    secret: ticketSecret,
    expectedEventId: eventId,
    nowMs: Date.now(),
  });
  const netInfo = classifyVerifiedNetwork(request);
  const selfReportedCarrier = normalizeSelfReportedCarrier(body.carrier);
  const payload: DemoTelemetryInput = {
    eventId,
    round:
      typeof body.round === 'number' && Number.isInteger(body.round)
        ? body.round
        : 1,
    selfReportedCarrier,
    verifiedNetwork: netInfo.verifiedNetwork,
    asn: netInfo.asn,
    asOrganization: netInfo.asOrganization,
    isMismatched: isSelfReportMismatch(selfReportedCarrier, netInfo),
    nickname: ticket.leaderboardUsername,
    attemptId: `${ticket.userId}:${attemptId}`,
    questionIndex,
    tapToAckMs,
    serverCommitMs:
      typeof body.serverCommitMs === 'number' &&
      Number.isFinite(body.serverCommitMs)
        ? Math.min(60_000, Math.max(0, body.serverCommitMs))
        : 0,
    retries:
      typeof body.retries === 'number' && Number.isFinite(body.retries)
        ? Math.min(10, Math.max(0, Math.floor(body.retries)))
        : 0,
    timedOut: Boolean(body.timedOut),
    colo: netInfo.colo,
  };
  return env.callDemoDo('/internal/demo/telemetry', payload);
}
