import type { OxygenSession } from './client';
import { OxygenClientError } from './errors';

type Session = OxygenSession & { expires_at?: number };
type Result = { data: { session: Session | null }; error: unknown };
interface AuthReader {
  getSession: () => PromiseLike<Result>;
  refreshSession: () => PromiseLike<Result>;
}
function assertSessionConnection(error: unknown) {
  if (
    error &&
    typeof error === 'object' &&
    'name' in error &&
    error.name === 'AuthRetryableFetchError'
  )
    throw new OxygenClientError('transport', undefined, 'not_dispatched');
}
/** Renew before dispatch, coalesce renewal, and recheck owner after every await. */
export function createOxygenSessionReader(
  auth: AuthReader,
  userId: string,
  isCurrent: () => boolean,
  now: () => number = Date.now
) {
  let pending: Promise<Result> | null = null;
  return async (): Promise<OxygenSession | null> => {
    if (!isCurrent()) return null;
    let result = await auth.getSession();
    assertSessionConnection(result.error);
    if (
      !isCurrent() ||
      (result.data.session && result.data.session.user.id !== userId)
    )
      return null;
    if (
      result.error ||
      !result.data.session ||
      (result.data.session.expires_at ?? 0) * 1000 <= now() + 60000
    ) {
      pending ??= Promise.resolve(auth.refreshSession()).finally(() => {
        pending = null;
      });
      result = await pending;
      assertSessionConnection(result.error);
    }
    const session = result.data.session;
    if (
      !isCurrent() ||
      result.error ||
      !session ||
      session.user.id !== userId ||
      (session.expires_at ?? 0) * 1000 <= now()
    )
      return null;
    return session;
  };
}
