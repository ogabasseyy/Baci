import {
  type QuizAdmissionTicket,
  type QuizMode,
  QuizRoomError,
  type QuizVerifiedBearerUser,
} from './contracts';
import {
  base64UrlDecodeString,
  base64UrlEncodeJson,
  constantTimeEqualStrings,
  hmacSha256Base64Url,
  verifyHmacSha256Base64Url,
} from './crypto';

const TICKET_PREFIX = 'bqt1';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function requireConfiguredSecret(
  value: string | undefined,
  name: string
): string {
  if (!isNonEmptyString(value)) {
    throw new QuizRoomError(
      'QUIZ_CONFIG_MISSING',
      `Required secret ${name} is not configured`,
      503
    );
  }
  return value.trim();
}

export function verifyInternalCoordinatorAuth(
  authorizationHeader: string | null | undefined,
  configuredSecret: string | undefined
): void {
  const secret = requireConfiguredSecret(
    configuredSecret,
    'QUIZ_INTERNAL_COORDINATOR_SECRET'
  );
  if (!authorizationHeader) {
    throw new QuizRoomError(
      'QUIZ_AUTH_REQUIRED',
      'Missing Authorization header',
      401
    );
  }
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  if (!match?.[1] || !constantTimeEqualStrings(match[1].trim(), secret)) {
    throw new QuizRoomError(
      'QUIZ_FORBIDDEN',
      'Invalid coordinator authorization',
      403
    );
  }
}

function isQuizMode(value: unknown): value is QuizMode {
  return value === 'test' || value === 'live';
}

function parseAdmissionTicketPayload(raw: unknown): QuizAdmissionTicket | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (
    !isNonEmptyString(obj.userId) ||
    !isNonEmptyString(obj.customerId) ||
    !isNonEmptyString(obj.merchantId) ||
    !isNonEmptyString(obj.eventId) ||
    !isNonEmptyString(obj.roomId) ||
    !isNonEmptyString(obj.deviceHash) ||
    typeof obj.leaderboardUsername !== 'string' ||
    typeof obj.expiresAtMs !== 'number' ||
    !Number.isFinite(obj.expiresAtMs)
  ) {
    return null;
  }
  if (obj.admissionId !== undefined && !isNonEmptyString(obj.admissionId)) {
    return null;
  }
  if (obj.mode !== undefined && !isQuizMode(obj.mode)) {
    return null;
  }
  if (
    obj.issuedAtMs !== undefined &&
    (typeof obj.issuedAtMs !== 'number' || !Number.isFinite(obj.issuedAtMs))
  ) {
    return null;
  }

  return {
    userId: obj.userId,
    customerId: obj.customerId,
    merchantId: obj.merchantId,
    eventId: obj.eventId,
    roomId: obj.roomId,
    deviceHash: obj.deviceHash,
    leaderboardUsername: obj.leaderboardUsername,
    expiresAtMs: obj.expiresAtMs,
    ...(obj.admissionId !== undefined ? { admissionId: obj.admissionId } : {}),
    ...(obj.mode !== undefined ? { mode: obj.mode } : {}),
    ...(obj.issuedAtMs !== undefined ? { issuedAtMs: obj.issuedAtMs } : {}),
  };
}

export async function signAdmissionTicket(
  ticket: QuizAdmissionTicket,
  secret: string
): Promise<string> {
  if (!isNonEmptyString(secret)) {
    throw new QuizRoomError(
      'QUIZ_TICKET_SECRET_MISSING',
      'Admission ticket signing secret is required',
      500
    );
  }
  const payloadSegment = base64UrlEncodeJson(ticket);
  const signingInput = `${TICKET_PREFIX}.${payloadSegment}`;
  const signature = await hmacSha256Base64Url(signingInput, secret);
  return `${signingInput}.${signature}`;
}

export interface VerifyAdmissionTicketOptions {
  secret: string;
  nowMs?: number;
  expectedEventId?: string;
  expectedRoomId?: string;
  expectedDeviceHash?: string;
}

export async function verifyAdmissionTicket(
  token: string,
  options: VerifyAdmissionTicketOptions
): Promise<QuizAdmissionTicket> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TICKET_PREFIX) {
    throw new QuizRoomError(
      'QUIZ_TICKET_INVALID',
      'Malformed quiz admission ticket',
      401
    );
  }
  const payloadSegment = parts[1] ?? '';
  const signature = parts[2] ?? '';
  const signingInput = `${TICKET_PREFIX}.${payloadSegment}`;

  const valid = await verifyHmacSha256Base64Url(
    signingInput,
    signature,
    options.secret
  );
  if (!valid) {
    throw new QuizRoomError(
      'QUIZ_TICKET_INVALID',
      'Invalid quiz admission ticket signature',
      401
    );
  }

  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(base64UrlDecodeString(payloadSegment));
  } catch {
    throw new QuizRoomError(
      'QUIZ_TICKET_INVALID',
      'Corrupted quiz admission ticket payload',
      401
    );
  }

  const ticket = parseAdmissionTicketPayload(parsedRaw);
  if (!ticket) {
    throw new QuizRoomError(
      'QUIZ_TICKET_INVALID',
      'Invalid quiz admission ticket claims',
      401
    );
  }

  const nowMs = options.nowMs ?? Date.now();
  if (nowMs >= ticket.expiresAtMs) {
    throw new QuizRoomError(
      'QUIZ_TICKET_EXPIRED',
      'Quiz admission ticket has expired',
      401
    );
  }
  if (options.expectedEventId && ticket.eventId !== options.expectedEventId) {
    throw new QuizRoomError(
      'QUIZ_TICKET_SCOPE_MISMATCH',
      'Ticket does not match event',
      403
    );
  }
  if (options.expectedRoomId && ticket.roomId !== options.expectedRoomId) {
    throw new QuizRoomError(
      'QUIZ_TICKET_SCOPE_MISMATCH',
      'Ticket does not match room',
      403
    );
  }
  if (
    options.expectedDeviceHash &&
    ticket.deviceHash !== options.expectedDeviceHash
  ) {
    throw new QuizRoomError('QZ040', 'quiz_device_binding_required', 403);
  }
  return ticket;
}

export interface BearerJwtClaims {
  sub: string;
  exp: number;
  iat?: number;
  nbf?: number;
  iss?: string;
  aud?: string | readonly string[];
  email?: string;
  role?: string;
  merchantId?: string;
  merchant_id?: string;
  customerId?: string;
  customer_id?: string;
}

export async function signBearerJwt(
  claims: BearerJwtClaims,
  secret: string
): Promise<string> {
  if (!isNonEmptyString(secret)) {
    throw new QuizRoomError(
      'QUIZ_JWT_SECRET_MISSING',
      'JWT signing secret is required',
      500
    );
  }
  const headerSegment = base64UrlEncodeJson({ alg: 'HS256', typ: 'JWT' });
  const payloadSegment = base64UrlEncodeJson(claims);
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const signature = await hmacSha256Base64Url(signingInput, secret);
  return `${signingInput}.${signature}`;
}

export interface VerifyBearerJwtOptions {
  secret: string;
  nowMs?: number;
  expectedIssuer?: string;
  expectedAudience?: string;
}

export async function verifyBearerJwt(
  authorizationHeader: string | null | undefined,
  options: VerifyBearerJwtOptions
): Promise<QuizVerifiedBearerUser> {
  if (!authorizationHeader) {
    throw new QuizRoomError(
      'QUIZ_AUTH_REQUIRED',
      'Missing Authorization header',
      401
    );
  }
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  if (!match?.[1]) {
    throw new QuizRoomError(
      'QUIZ_AUTH_REQUIRED',
      'Invalid Authorization scheme',
      401
    );
  }
  const token = match[1].trim();
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new QuizRoomError('QUIZ_JWT_INVALID', 'Malformed bearer JWT', 401);
  }

  const headerSeg = parts[0] ?? '';
  const payloadSeg = parts[1] ?? '';
  const signature = parts[2] ?? '';
  const signingInput = `${headerSeg}.${payloadSeg}`;

  let headerObj: unknown;
  try {
    headerObj = JSON.parse(base64UrlDecodeString(headerSeg));
  } catch {
    throw new QuizRoomError('QUIZ_JWT_INVALID', 'Malformed JWT header', 401);
  }
  if (
    !headerObj ||
    typeof headerObj !== 'object' ||
    (headerObj as Record<string, unknown>).alg !== 'HS256'
  ) {
    throw new QuizRoomError(
      'QUIZ_JWT_UNSUPPORTED_ALG',
      'Unsupported JWT algorithm',
      401
    );
  }

  const valid = await verifyHmacSha256Base64Url(
    signingInput,
    signature,
    options.secret
  );
  if (!valid) {
    throw new QuizRoomError('QUIZ_JWT_INVALID', 'Invalid JWT signature', 401);
  }

  let claimsRaw: unknown;
  try {
    claimsRaw = JSON.parse(base64UrlDecodeString(payloadSeg));
  } catch {
    throw new QuizRoomError('QUIZ_JWT_INVALID', 'Malformed JWT payload', 401);
  }
  if (!claimsRaw || typeof claimsRaw !== 'object') {
    throw new QuizRoomError('QUIZ_JWT_INVALID', 'Invalid JWT payload', 401);
  }
  const claims = claimsRaw as Record<string, unknown>;
  if (!isNonEmptyString(claims.sub) || typeof claims.exp !== 'number') {
    throw new QuizRoomError(
      'QUIZ_JWT_INVALID',
      'JWT missing required sub or exp claim',
      401
    );
  }

  const nowSec = Math.floor((options.nowMs ?? Date.now()) / 1000);
  if (nowSec >= claims.exp) {
    throw new QuizRoomError('QUIZ_JWT_EXPIRED', 'Bearer JWT has expired', 401);
  }
  if (typeof claims.nbf === 'number' && nowSec < claims.nbf) {
    throw new QuizRoomError(
      'QUIZ_JWT_NOT_ACTIVE',
      'Bearer JWT is not active yet',
      401
    );
  }
  if (options.expectedIssuer && claims.iss !== options.expectedIssuer) {
    throw new QuizRoomError('QUIZ_JWT_INVALID', 'JWT issuer mismatch', 401);
  }
  if (options.expectedAudience) {
    const aud = claims.aud;
    const matchesAud = Array.isArray(aud)
      ? aud.includes(options.expectedAudience)
      : aud === options.expectedAudience;
    if (!matchesAud) {
      throw new QuizRoomError('QUIZ_JWT_INVALID', 'JWT audience mismatch', 401);
    }
  }

  const merchantClaim = isNonEmptyString(claims.merchantId)
    ? claims.merchantId
    : isNonEmptyString(claims.merchant_id)
      ? claims.merchant_id
      : undefined;
  const customerClaim = isNonEmptyString(claims.customerId)
    ? claims.customerId
    : isNonEmptyString(claims.customer_id)
      ? claims.customer_id
      : undefined;

  return {
    userId: claims.sub,
    expiresAtMs: claims.exp * 1000,
    ...(typeof claims.iat === 'number'
      ? { issuedAtMs: claims.iat * 1000 }
      : {}),
    ...(typeof claims.email === 'string' ? { email: claims.email } : {}),
    ...(typeof claims.role === 'string' ? { role: claims.role } : {}),
    ...(merchantClaim ? { merchantId: merchantClaim } : {}),
    ...(customerClaim ? { customerId: customerClaim } : {}),
  };
}
