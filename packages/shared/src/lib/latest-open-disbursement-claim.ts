export interface DisbursementClaimEvent {
  id: number;
  type: string;
  createdAt: string;
  details: Record<string, unknown>;
}

/** Return the newest disbursement claim that has no matching verification. */
export function findLatestOpenDisbursementClaim<
  TEvent extends DisbursementClaimEvent,
>(events: readonly TEvent[]): TEvent | null {
  const verifiedClaimIds = new Set(
    events
      .filter((event) => event.type === 'offline_disbursement_verified')
      .map((event) => event.details.claimId)
      .filter((claimId): claimId is string => typeof claimId === 'string')
  );

  return (
    [...events]
      .filter(
        (event) =>
          event.type === 'offline_disbursement_claimed' &&
          typeof event.details.claimId === 'string' &&
          !verifiedClaimIds.has(event.details.claimId)
      )
      .sort(
        (left, right) =>
          Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
          right.id - left.id
      )[0] ?? null
  );
}
