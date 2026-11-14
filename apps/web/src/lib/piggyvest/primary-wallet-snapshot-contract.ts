/**
 * Client contract for the primary wallet GET snapshot.
 *
 * Installed mobile builds parse the snapshot with a strict union that knows
 * only `pending` and `ready`, so an unrecognised status breaks their wallet
 * setup until a new store release is adopted. A client opts in to the
 * `not_started` status by sending snapshot version 2 in this header; every
 * other client keeps the reply it already accepts, which is also what a
 * never-started customer received before the presence check existed.
 */
export const PRIMARY_WALLET_SNAPSHOT_VERSION_HEADER =
  'x-baci-piggyvest-snapshot-version';

const NOT_STARTED_SNAPSHOT_VERSION = '2';

export function notStartedPrimaryWalletSnapshot(headers: Headers) {
  return headers.get(PRIMARY_WALLET_SNAPSHOT_VERSION_HEADER) ===
    NOT_STARTED_SNAPSHOT_VERSION
    ? ({ status: 'not_started', account: null } as const)
    : ({ status: 'pending', account: null } as const);
}
