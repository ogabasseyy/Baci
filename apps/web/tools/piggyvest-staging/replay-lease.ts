import type { SealedReplayReceipt } from './replay-crypto';

export type ReplayLease = {
  receiptId: string;
  eventId: string | null;
  claimToken: string;
  sealed: SealedReplayReceipt;
};
