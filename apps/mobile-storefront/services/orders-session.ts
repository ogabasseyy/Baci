import type { Session, SupportedStorage } from '@supabase/supabase-js';
import { readCheckoutStoredSession } from './read-checkout-stored-session';

export async function getCheckoutStoredSession(
  storage: Pick<SupportedStorage, 'getItem'> | undefined,
  storageKey: string,
  timeoutMs?: number
): Promise<Session | null> {
  const { session } = await readCheckoutStoredSession(
    storage,
    storageKey,
    timeoutMs
  );
  return session;
}
