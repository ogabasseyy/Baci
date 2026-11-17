import { createLogger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { getSafeErrorMessage } from '@/services/quiz-service-utils';
import { QuizServiceError } from '@/services/quiz-types';

const log = createLogger('QuizAuth');

const QUIZ_AUTH_RETRY_DELAY_MS = 300;

function waitForQuizAuthRetry() {
  return new Promise((resolve) => {
    setTimeout(resolve, QUIZ_AUTH_RETRY_DELAY_MS);
  });
}

function isDefinitiveAuthError(error: unknown): boolean {
  const message = getSafeErrorMessage(error).toLowerCase();
  const status =
    error &&
    typeof error === 'object' &&
    'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : null;

  return (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    message.includes('invalid') ||
    message.includes('expired') ||
    message.includes('jwt') ||
    message.includes('refresh token')
  );
}

export async function getQuizAuthHeaders(): Promise<{
  headers: Record<string, string>;
  userId: string;
}> {
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const canRetry = attempt < maxAttempts;

    try {
      const { data, error } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;

      if (error) {
        log.warn('Unable to read quiz auth session', {
          attempt,
          message: getSafeErrorMessage(error),
        });
        if (canRetry && !isDefinitiveAuthError(error)) {
          await waitForQuizAuthRetry();
          continue;
        }
        break;
      }

      if (!accessToken) {
        // No session yet — during cold-start the store is still hydrating the
        // session, so retry once before failing rather than spuriously rejecting
        // the first quiz action.
        if (canRetry) {
          await waitForQuizAuthRetry();
          continue;
        }
        break;
      }

      // The server verifies the bearer token on every request, so the user id
      // comes from the session we already hold. Avoiding a per-request
      // Supabase Auth round trip keeps load off auth during a live quiz.
      const userId = data.session?.user?.id;
      if (userId) {
        return {
          headers: { Authorization: `Bearer ${accessToken}` },
          userId,
        };
      }
      // A token without its user is storage that has only half loaded. Give
      // it the same single retry as a missing token before failing.
      log.warn('Quiz auth session has a token but no user yet', { attempt });
      if (canRetry) {
        await waitForQuizAuthRetry();
        continue;
      }
      break;
    } catch (error) {
      log.warn('Unable to read quiz auth session', {
        attempt,
        message: getSafeErrorMessage(error),
      });
      if (canRetry && !isDefinitiveAuthError(error)) {
        await waitForQuizAuthRetry();
        continue;
      }
      break;
    }
  }

  throw new QuizServiceError(
    'Quiz authentication required',
    'QUIZ_AUTH_REQUIRED',
    401
  );
}
