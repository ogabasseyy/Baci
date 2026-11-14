import { useEffect, useRef } from 'react';
import type { createClient } from '@/lib/supabase/client';
import { readNegotiationVatRate } from './negotiation-live-vat';

export function useNegotiationLiveVat(
  isOpen: boolean,
  merchantId: string,
  merchantSlug: string | undefined,
  getClient: () => Promise<ReturnType<typeof createClient>>
) {
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [isOpen, merchantId, merchantSlug]
  );

  return async (): Promise<number | undefined> => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    try {
      const client = await getClient();
      if (controller.signal.aborted) return undefined;
      const value = await readNegotiationVatRate(
        client,
        merchantSlug ?? '',
        merchantId,
        controller.signal
      );
      return controller.signal.aborted ? undefined : value;
    } catch (error) {
      if (controller.signal.aborted) return undefined;
      throw error;
    }
  };
}
