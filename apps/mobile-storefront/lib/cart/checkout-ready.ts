interface CheckoutState {
  enabled: boolean;
  status?: string;
  metadataReady?: boolean;
  mergeConflicts?: readonly unknown[];
  snapshot?: { state: string; lines: readonly unknown[] } | null;
}
export function sharedCartCheckoutReady(state: CheckoutState): boolean {
  return (
    !state.enabled ||
    Boolean(
      state.status === 'ready' &&
        state.metadataReady &&
        !state.mergeConflicts?.length &&
        state.snapshot &&
        ['active', 'checkout'].includes(state.snapshot.state) &&
        state.snapshot.lines.length
    )
  );
}
