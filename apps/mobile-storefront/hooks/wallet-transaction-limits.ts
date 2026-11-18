/** Older store credit rows the wallet shows. */
export const STORE_CREDIT_ROW_LIMIT = 20;

/**
 * Legacy ledger rows read per load. More than is shown, because rows that
 * mirror PiggyVest wallet activity are hidden afterwards and must never push
 * plain store credit rows out of the visible window.
 */
export const WALLET_TRANSACTION_FETCH_LIMIT = 100;
