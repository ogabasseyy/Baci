import type { Session, User } from '@supabase/supabase-js';
import { createLogger } from '../lib/logger';
import { hydrateCustomer } from './auth-customer-hydration';
import type { AuthStoreSet } from './auth-store.types';

const log = createLogger('AuthStore');

export async function syncAuthenticatedState({
  getInitGen,
  initGen,
  merchantId,
  session,
  set,
  skipImmediateState = false,
  user,
}: {
  getInitGen?: () => number;
  initGen?: number;
  merchantId: string | null;
  session: Session | null;
  set: AuthStoreSet;
  skipImmediateState?: boolean;
  user: User;
}): Promise<void> {
  const isStale =
    initGen !== undefined &&
    getInitGen !== undefined &&
    getInitGen() !== initGen;

  if (isStale) return;
  if (!skipImmediateState) {
    set({ error: null, isInitialized: true, session, user });
  }

  if (!merchantId) {
    set({ customer: null });
    return;
  }

  try {
    const customer = await hydrateCustomer({
      getInitGen,
      initGen,
      merchantId,
      user,
      useTimeout: false,
    });

    if (
      initGen !== undefined &&
      getInitGen !== undefined &&
      getInitGen() !== initGen
    ) {
      return;
    }

    set({ customer });
  } catch (error) {
    if (
      initGen !== undefined &&
      getInitGen !== undefined &&
      getInitGen() !== initGen
    ) {
      return;
    }

    log.warn('Post-auth customer hydration failed:', error);
    set({ customer: null });
  }
}
