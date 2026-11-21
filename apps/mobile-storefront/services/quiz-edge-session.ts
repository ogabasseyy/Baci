import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

export const quizEdgeCheckInResponseSchema = z.object({
  admissionId: z.string().uuid(),
  eventId: z.string().uuid(),
  merchantId: z.string().uuid(),
  roomId: z.string().min(1),
  roomIndex: z.number().int().nonnegative(),
  leaderboardUsername: z.string().min(1),
  maxAttempts: z.number().int().positive(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  rulesVersion: z.string().min(1),
  reused: z.boolean(),
  backendMode: z.literal('edge_rooms'),
  edgeBaseUrl: z.string().url(),
  ticket: z.string().startsWith('bqt1.'),
});

export type QuizEdgeCheckInSession = z.infer<
  typeof quizEdgeCheckInResponseSchema
> & {
  expectedUserId?: string;
};

const activeEdgeSessions = new Map<string, QuizEdgeCheckInSession>();
const activeAttemptSessions = new Map<string, QuizEdgeCheckInSession>();
const EDGE_ATTEMPT_STORAGE_PREFIX = '@baci/quiz-edge-attempt:';
const EDGE_EVENT_STORAGE_PREFIX = '@baci/quiz-edge-event:';

function sessionKey(eventId: string, expectedUserId?: string): string {
  return `${eventId}:${expectedUserId ?? 'anon'}`;
}

export function saveQuizEdgeSession(
  eventId: string,
  session: QuizEdgeCheckInSession
): void {
  const key = sessionKey(eventId, session.expectedUserId);
  activeEdgeSessions.set(key, session);
  AsyncStorage.setItem(
    `${EDGE_EVENT_STORAGE_PREFIX}${key}`,
    JSON.stringify(session)
  ).catch(() => undefined);
}

export async function resolveQuizEdgeSessionForEvent(
  eventId: string,
  expectedUserId?: string
): Promise<QuizEdgeCheckInSession | undefined> {
  const key = sessionKey(eventId, expectedUserId);
  const cached = activeEdgeSessions.get(key);
  if (cached) return cached;
  try {
    const raw = await AsyncStorage.getItem(
      `${EDGE_EVENT_STORAGE_PREFIX}${key}`
    );
    if (!raw) return undefined;
    const rawJson = JSON.parse(raw) as Record<string, unknown>;
    const parsed = quizEdgeCheckInResponseSchema.safeParse(rawJson);
    if (!parsed.success) return undefined;
    const storedExpectedUserId =
      typeof rawJson.expectedUserId === 'string'
        ? rawJson.expectedUserId
        : undefined;
    if (
      expectedUserId &&
      storedExpectedUserId &&
      storedExpectedUserId !== expectedUserId
    ) {
      return undefined;
    }
    const session: QuizEdgeCheckInSession = {
      ...parsed.data,
      edgeBaseUrl: parsed.data.edgeBaseUrl.replace(/\/$/, ''),
      expectedUserId: storedExpectedUserId,
    };
    activeEdgeSessions.set(key, session);
    return session;
  } catch {
    return undefined;
  }
}

export function getQuizEdgeSession(
  eventId: string,
  expectedUserId?: string
): QuizEdgeCheckInSession | undefined {
  return activeEdgeSessions.get(sessionKey(eventId, expectedUserId));
}

export function getQuizEdgeSessionForAttempt(
  attemptId: string
): QuizEdgeCheckInSession | undefined {
  return activeAttemptSessions.get(attemptId);
}

export async function saveQuizEdgeAttemptSession(
  attemptId: string,
  session: QuizEdgeCheckInSession
): Promise<void> {
  activeAttemptSessions.set(attemptId, session);
  await AsyncStorage.setItem(
    `${EDGE_ATTEMPT_STORAGE_PREFIX}${attemptId}`,
    JSON.stringify(session)
  ).catch(() => undefined);
}

/**
 * Resolves an edge session for an attempt, hydrating from AsyncStorage after
 * an OS cold restart or background kill and verifying `expectedUserId` match.
 */
export async function resolveQuizEdgeSessionForAttempt(
  attemptId: string,
  expectedUserId?: string
): Promise<QuizEdgeCheckInSession | undefined> {
  const matchesUser = (s: QuizEdgeCheckInSession) =>
    !expectedUserId || !s.expectedUserId || s.expectedUserId === expectedUserId;

  const cached = activeAttemptSessions.get(attemptId);
  if (cached) return matchesUser(cached) ? cached : undefined;
  try {
    const raw = await AsyncStorage.getItem(
      `${EDGE_ATTEMPT_STORAGE_PREFIX}${attemptId}`
    );
    if (!raw) return undefined;
    const rawJson = JSON.parse(raw) as Record<string, unknown>;
    const parsed = quizEdgeCheckInResponseSchema.safeParse(rawJson);
    if (!parsed.success) return undefined;
    const storedExpectedUserId =
      typeof rawJson.expectedUserId === 'string'
        ? rawJson.expectedUserId
        : undefined;
    const session: QuizEdgeCheckInSession = {
      ...parsed.data,
      edgeBaseUrl: parsed.data.edgeBaseUrl.replace(/\/$/, ''),
      expectedUserId: storedExpectedUserId,
    };
    if (!matchesUser(session)) return undefined;
    activeAttemptSessions.set(attemptId, session);
    return session;
  } catch {
    return undefined;
  }
}

export function clearQuizEdgeSession(
  eventId: string,
  expectedUserId?: string
): void {
  const key = sessionKey(eventId, expectedUserId);
  const existing = activeEdgeSessions.get(key);
  activeEdgeSessions.delete(key);
  AsyncStorage.removeItem(`${EDGE_EVENT_STORAGE_PREFIX}${key}`).catch(
    () => undefined
  );
  const matchesSession = (session: QuizEdgeCheckInSession): boolean =>
    session === existing ||
    (session.eventId === eventId &&
      (!expectedUserId ||
        !session.expectedUserId ||
        session.expectedUserId === expectedUserId));
  for (const [attemptId, session] of activeAttemptSessions.entries()) {
    if (matchesSession(session)) {
      activeAttemptSessions.delete(attemptId);
      AsyncStorage.removeItem(
        `${EDGE_ATTEMPT_STORAGE_PREFIX}${attemptId}`
      ).catch(() => undefined);
    }
  }
}
