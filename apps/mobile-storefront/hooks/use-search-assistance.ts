import {
  readAssistanceStream,
  type SearchAssistanceProposal,
} from '@baci/shared/lib';
import { fetch } from 'expo/fetch';
import { randomUUID } from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { CONFIG } from '@/lib/config';

export function useSearchAssistance(query: string) {
  const endpoint = process.env.EXPO_PUBLIC_SEARCH_ASSIST_URL;
  const controller = useRef<AbortController | null>(null);
  const [state, setState] = useState<{
    query: string;
    pending: boolean;
    proposal?: SearchAssistanceProposal;
    error?: string;
  }>({ query, pending: false });
  useEffect(() => {
    controller.current?.abort();
    controller.current = null;
    setState({ query, pending: false });
    return () => {
      controller.current?.abort();
      controller.current = null;
    };
  }, [query]);
  const ask = async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setState({ query, pending: true });
    const timeout = setTimeout(() => request.abort(), 15000);
    try {
      if (!endpoint) throw new Error('Unavailable');
      const requestId = randomUUID();
      const response = await fetch(endpoint, {
        method: 'POST',
        // Assert the build merchant: hostless mobile callers otherwise fall
        // back to the server-configured tenant, so an unsupported build
        // would silently consume another merchant's budget and branding.
        headers: {
          'Content-Type': 'application/json',
          'x-baci-storefront-slug': CONFIG.MERCHANT_SLUG,
        },
        body: JSON.stringify({ query, requestId }),
        signal: request.signal,
      });
      await readAssistanceStream(
        response,
        requestId,
        request.signal,
        (frame) => {
          if (request !== controller.current || request.signal.aborted) return;
          if (frame.event.kind === 'proposal')
            setState({ query, pending: false, proposal: frame.event.proposal });
          if (frame.event.kind === 'error')
            throw new Error(frame.event.message);
        }
      );
    } catch {
      if (request === controller.current)
        setState({
          query,
          pending: false,
          error: 'Assistance couldn’t finish. Keep searching or try again.',
        });
    } finally {
      clearTimeout(timeout);
      if (request === controller.current)
        setState((s) => ({ ...s, pending: false }));
    }
  };
  return {
    enabled: Boolean(endpoint),
    ask,
    ...(state.query === query ? state : { query, pending: false }),
    dismiss: () => {
      const active = controller.current;
      controller.current = null;
      active?.abort();
      setState({ query, pending: false });
    },
  };
}
