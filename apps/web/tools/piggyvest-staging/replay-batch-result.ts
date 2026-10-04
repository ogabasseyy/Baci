export type ReplayBatchResult = {
  claimed: number;
  processed: number;
  retryable: number;
  quarantined: number;
  resolutionFailures: number;
};
