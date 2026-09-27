/**
 * Counters and recoverable errors returned by one Jumia order sync pass.
 */
export interface JumiaOrderSyncResult {
  /** Active marketplace integrations inspected during this run. */
  integrations: number;
  /** Jumia orders fetched and processed across all enabled integrations. */
  synced: number;
  /** Baci canonical order rows created from Jumia orders. */
  canonicalCreated: number;
  /** Existing Baci canonical order rows updated from Jumia orders. */
  canonicalUpdated: number;
  /** Merchant push notifications successfully sent for synced Jumia orders. */
  notified: number;
  /** Stock updates pushed for self-authorized integrations with stock sync. */
  stockUpdated: number;
  /**
   * Order-level processing failures that did not abort the whole integration.
   * Each increment should have a matching per-order entry in `errors`, for
   * example `merchant-id/jumia-order-id: item API timeout`.
   */
  orderErrors: number;
  /**
   * Recoverable messages captured without aborting the run. This includes
   * per-order failures counted by `orderErrors` and separate integration-level
   * warnings such as notification marker update failures.
   */
  errors: string[];
}
