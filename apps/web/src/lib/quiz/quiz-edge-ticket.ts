import { createHmac } from 'node:crypto';

const TICKET_PREFIX = 'bqt1';

export interface QuizEdgeAdmissionTicketPayload {
  userId: string;
  customerId: string;
  merchantId: string;
  eventId: string;
  roomId: string;
  admissionId: string;
  deviceHash: string;
  leaderboardUsername: string;
  expiresAtMs: number;
  mode: 'live' | 'test';
}

/**
 * Signs a compact HMAC-SHA256 `bqt1.<payload>.<sig>` admission ticket matching
 * `apps/quiz-room-prototype/src/ticket.ts` (`verifyAdmissionTicket`).
 */
export function signQuizEdgeAdmissionTicket(
  payload: QuizEdgeAdmissionTicketPayload,
  secret: string
): string {
  const trimmedSecret = secret.trim();
  if (!trimmedSecret) {
    throw new Error('QUIZ_TICKET_SECRET is required to sign admission tickets');
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url'
  );
  const signingInput = `${TICKET_PREFIX}.${encodedPayload}`;
  const signature = createHmac('sha256', trimmedSecret)
    .update(signingInput, 'utf8')
    .digest('base64url');
  return `${signingInput}.${signature}`;
}
