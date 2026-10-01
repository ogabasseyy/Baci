import type { CustomerWalletPaymentAccountErrorCode } from '@/lib/customer-wallet-payment-account-types';

/**
 * Snake_case PostHog event vocabulary for the web wallet bank-transfer (Paystack
 * DVA) funding funnel. Names mirror the mobile-storefront wallet events (e.g.
 * `wallet_funding_account_create_failed`) so the two platforms report into the
 * same funnel. Known reason codes map 1:1 to the funding-account API `code`
 * values; `network` and `other` are synthetic telemetry buckets with no API
 * counterpart (request never reached the API / unrecognized code).
 */
export const WALLET_FUNDING_TELEMETRY = {
  events: {
    surfaceOpened: 'wallet_funding_surface_opened',
    createAttempted: 'wallet_funding_account_create_attempted',
    accountCreated: 'wallet_funding_account_created',
    createFailed: 'wallet_funding_account_create_failed',
    paymentMethodSelected: 'utility_payment_method_selected',
    transferCredited: 'wallet_funding_transfer_credited',
    // Client-side "I've transferred — checking…" loop. `transferCheckStarted`
    // is the customer arming the poll; `transferCheckSettled` carries
    // `outcome: 'credited' | 'timed_out'`. Deliberately NOT `transferCredited`:
    // that one is emitted server-side with a deterministic dedupe uuid
    // (customer-wallet-top-up.ts), so a client copy would double-count the
    // funnel's terminal step.
    transferCheckStarted: 'wallet_funding_transfer_check_started',
    transferCheckSettled: 'wallet_funding_transfer_check_settled',
  },
  surfaces: {
    utilityModal: 'utility_modal',
    walletPage: 'wallet_page',
  },
  reasons: {
    // Every member of `CustomerWalletPaymentAccountErrorCode`
    // (@/lib/customer-wallet-payment-account-types) …
    customerNameRequired: 'CUSTOMER_NAME_REQUIRED',
    customerPhoneRequired: 'CUSTOMER_PHONE_REQUIRED',
    gatewayNotConfigured: 'GATEWAY_NOT_CONFIGURED',
    paystackCustomerError: 'PAYSTACK_CUSTOMER_ERROR',
    paystackDvaError: 'PAYSTACK_DVA_ERROR',
    orderAliasConflict: 'WALLET_DVA_ORDER_ALIAS_CONFLICT',
    receiverConflict: 'WALLET_DVA_RECEIVER_CONFLICT',
    storageError: 'WALLET_DVA_STORAGE_ERROR',
    subaccountConflict: 'WALLET_DVA_SUBACCOUNT_CONFLICT',
    // … plus the feature-flag rejection the funding-account route returns
    // directly (not thrown as a CustomerWalletPaymentAccountError).
    dvaDisabled: 'WALLET_DVA_DISABLED',
    // Synthetic telemetry buckets with no API counterpart.
    network: 'network',
    other: 'other',
  },
} as const;

export type WalletFundingSurface =
  (typeof WALLET_FUNDING_TELEMETRY.surfaces)[keyof typeof WALLET_FUNDING_TELEMETRY.surfaces];

export type WalletFundingFailureReason =
  (typeof WALLET_FUNDING_TELEMETRY.reasons)[keyof typeof WALLET_FUNDING_TELEMETRY.reasons];

/**
 * Compile-time drift guard (type-only, no runtime cost). Adding a member to
 * `CustomerWalletPaymentAccountErrorCode` without a matching `reasons` entry
 * above makes the default type argument violate its `never` constraint, which
 * fails `tsc` — so a new API failure code can never silently land in `other`.
 */
type _AssertEveryApiCodeHasAReason<
  _Uncovered extends never = Exclude<
    CustomerWalletPaymentAccountErrorCode,
    WalletFundingFailureReason
  >,
> = true;
