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

function sessionKey(eventId: string, expectedUserId?: string): string {
  return `${eventId}:${expectedUserId ?? 'anon'}`;
}

export function saveQuizEdgeSession(
  eventId: string,
  session: QuizEdgeCheckInSession
): void {
  activeEdgeSessions.set(sessionKey(eventId, session.expectedUserId), session);
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
  if (!existing) return;
  for (const [attemptId, session] of activeAttemptSessions.entries()) {
    if (session === existing) {
      activeAttemptSessions.delete(attemptId);
      AsyncStorage.removeItem(
        `${EDGE_ATTEMPT_STORAGE_PREFIX}${attemptId}`
      ).catch(() => undefined);
    }
  }
}
