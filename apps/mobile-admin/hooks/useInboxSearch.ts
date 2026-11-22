import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useMerchant } from '@/hooks/useMerchant';
import { inboxSearchKey } from '@/lib/inbox-query-keys';
import { searchInbox } from '@/lib/merchant-inbox-api';

export const INBOX_SEARCH_MIN_LENGTH = 2;
const DEBOUNCE_MS = 350;

/** Searches chats once the person pauses typing; shorter terms search nothing. */
export function useInboxSearch(rawTerm: string) {
  const { merchant } = useMerchant();
  const [term, setTerm] = useState('');

  useEffect(() => {
    const next = rawTerm.trim();
    const timer = setTimeout(() => setTerm(next), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [rawTerm]);

  const active = term.length >= INBOX_SEARCH_MIN_LENGTH;
  const query = useQuery({
    enabled: !!merchant?.id && active,
    queryFn: () => searchInbox(term),
    queryKey: inboxSearchKey(merchant?.id, term),
    staleTime: 30_000,
  });

  return {
    // Typing but not yet searched: show nothing stale, just "searching".
    isPending:
      rawTerm.trim().length >= INBOX_SEARCH_MIN_LENGTH &&
      (!active || term !== rawTerm.trim() || query.isLoading),
    isError: query.isError,
    results:
      active && term === rawTerm.trim() ? (query.data?.results ?? []) : [],
    refetch: query.refetch,
  };
}
