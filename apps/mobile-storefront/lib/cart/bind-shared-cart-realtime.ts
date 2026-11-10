import { getSupabaseRealtimeConfig } from '@/lib/supabase';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import { startSharedCartRealtime } from './shared-cart-realtime';
import { createNativeRealtimeDeps } from './shared-cart-realtime-transport';

/** Opens the push channel for the current cart and follows cart changes; returns teardown. */
export function bindSharedCartRealtime(config: {
  merchantId: string;
  merchantSlug: string;
  apiOrigin: string;
  subjectKey: string;
  isCurrent(): boolean;
  refresh(): Promise<void>;
}): () => void {
  // A build without project credentials stays on polling instead of retrying forever.
  if (!getSupabaseRealtimeConfig()) return () => undefined;
  const realtime = startSharedCartRealtime(
    {
      merchantId: config.merchantId,
      getCartId: () =>
        useNativeSharedCartStore.getState().snapshot?.cartId ?? null,
      getVersion: () =>
        useNativeSharedCartStore.getState().snapshot?.version ?? 0,
      isCurrent: config.isCurrent,
      refresh: config.refresh,
    },
    createNativeRealtimeDeps({
      merchantId: config.merchantId,
      merchantSlug: config.merchantSlug,
      apiOrigin: config.apiOrigin,
      ownerSubject:
        config.subjectKey === 'guest' ? undefined : config.subjectKey,
    })
  );
  const unwatch = useNativeSharedCartStore.subscribe((state, previous) => {
    if (state.snapshot?.cartId !== previous.snapshot?.cartId) realtime.sync();
  });
  return () => {
    unwatch();
    realtime.stop();
  };
}
