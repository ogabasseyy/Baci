import type { Session, SupportedStorage } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const log = createLogger('Order');
const CHECKOUT_SESSION_TIMEOUT_MS = 5_000;

function parseStoredSession(value: string | null): Session | null {
  if (!value) return null;
  try {
    const session = JSON.parse(value) as Partial<Session>;
    return session.access_token && session.refresh_token && session.user?.id
      ? (session as Session)
      : null;
  } catch {
    return null;
  }
}

export async function readCheckoutStoredSession(
  storage: Pick<SupportedStorage, 'getItem'> | undefined,
  storageKey: string,
  timeoutMs = CHECKOUT_SESSION_TIMEOUT_MS
): Promise<{ session: Session | null; timedOut: boolean }> {
  if (!storage || !storageKey) {
    return { session: null, timedOut: false };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error('Checkout session read timed out')),
      timeoutMs
    );
  });

  try {
    const value = await Promise.race([storage.getItem(storageKey), timeout]);
    return { session: parseStoredSession(value), timedOut: false };
  } catch (error) {
    log.warn(
      'Unable to read checkout session within timeout; using guest checkout',
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    );
    return { session: null, timedOut: true };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
