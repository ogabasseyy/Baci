/** IMEI check states where the charge is held: the check has not finished. */
export const HELD_STATUSES = new Set([
  'pending',
  'provider_submitting',
  'pending_provider',
  'submission_unknown',
]);

/** The check failed and its charge is on its way back to the wallet. */
export const REFUNDING_STATUS = 'refund_pending';

/** Finished states: the row reads as a plain charge (or its refund row). */
export const FINISHED_STATUSES = new Set([
  'completed',
  'wallet_rejected',
  'failed_error',
  'refunded_error',
  'refunded_not_found',
]);

/** Ledger source of an IMEI check paid from the wallet. */
export const IMEI_CHARGE_SOURCE = 'imei_wallet_payment';

/** How long the status read may take before rows show unmarked. */
export const STATUS_READ_TIMEOUT_MS = 5000;

/** Time kept back from the wallet deadline to return the loaded data. */
export const WALLET_RETURN_MARGIN_MS = 2000;
