import 'server-only';
import { createScopedClient } from '@/lib/supabase/scoped';
import { signScopedSupabaseJwt } from '@/lib/supabase/scoped-jwt';

const QUIZ_AWARD_CONTEXT_TTL_SECONDS = 5 * 60;

type QuizRpcClient = {
  rpc(
    functionName: string,
    args?: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: unknown }>;
};

/**
 * Creates the short-lived server context used while a legacy quiz answer may
 * atomically create a zero-total prize order. The database trigger accepts
 * this claim only for an authenticated customer-owned quiz award row.
 */
export function createQuizAwardRpcClient({
  fallbackClient,
  userId,
  now = new Date(),
}: {
  fallbackClient: QuizRpcClient;
  userId: string;
  now?: Date;
}): QuizRpcClient {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new Error('Quiz award user context is required');
  }

  try {
    const issuedAt = Math.floor(now.getTime() / 1000);
    const token = signScopedSupabaseJwt({
      aud: 'authenticated',
      exp: issuedAt + QUIZ_AWARD_CONTEXT_TTL_SECONDS,
      iat: issuedAt,
      quiz_award_context: 'legacy-answer',
      role: 'authenticated',
      sub: normalizedUserId,
    });

    return createScopedClient(token) as unknown as QuizRpcClient;
  } catch (error) {
    // Route tests inject a mock client without JWT signing material. Never use
    // that fallback outside tests; production must fail closed.
    if (process.env.NODE_ENV === 'test') {
      return fallbackClient;
    }
    throw error;
  }
}
