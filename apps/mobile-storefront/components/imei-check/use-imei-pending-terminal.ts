import { useEffect, useEffectEvent } from 'react';
import type { useImeiPendingLookup } from './use-imei-pending-lookup';

type PendingTerminal = NonNullable<
  ReturnType<typeof useImeiPendingLookup>['terminal']
>;

/** Hands each final answer of a polled lookup to `onTerminal`, once. */
export function useImeiPendingTerminal(
  terminal: PendingTerminal | null,
  onTerminal: (terminal: PendingTerminal) => void
) {
  const handle = useEffectEvent(onTerminal);
  useEffect(() => {
    if (terminal) handle(terminal);
  }, [terminal]);
}
