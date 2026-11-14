/** Registry of per-feature enable flags. Read them only via isPiggyvestFeatureOn. */
export const PIGGYVEST_FEATURE_FLAGS = {
  wallet: 'PIGGYVEST_PRIMARY_ENABLED',
  deposit_to_goal: 'PIGGYVEST_PRIMARY_SAVINGS_ENABLED',
  goal_provisioning: 'PIGGYVEST_PRIMARY_SAVINGS_PROVISIONING_ENABLED',
  plan_funding: 'PIGGYVEST_SAVINGS_FUNDING_DISPLAY_ENABLED',
  card_checkout: 'PIGGYVEST_PRIMARY_CARD_ENABLED',
  card_custody: 'PIGGYVEST_PRIMARY_CARD_CUSTODY_ENABLED',
  inflows: 'PIGGYVEST_PRIMARY_INFLOWS_ENABLED',
  paid_interest: 'PIGGYVEST_PRIMARY_PAID_INTEREST_ENABLED',
  bank_inbox: 'PIGGYVEST_PRIMARY_BANK_INBOX_ENABLED',
  card_signed_inbox: 'PIGGYVEST_PRIMARY_CARD_SIGNED_INBOX_ENABLED',
  paid_interest_inbox: 'PIGGYVEST_PRIMARY_PAID_INTEREST_INBOX_ENABLED',
  // Prefunded first-card rails bring new money into a savings goal too.
  prefunded_card_checkout: 'PREFUNDED_CARD_CHECKOUT_PUBLIC_ENABLED',
  prefunded_card_checkout_mutations:
    'PREFUNDED_CARD_CHECKOUT_MUTATIONS_ENABLED',
  prefunded_card_contributions: 'PREFUNDED_CARD_PUBLIC_ENABLED',
  // Pay for IMEI checks and VTU from the PiggyVest main wallet (new outflow).
  wallet_pay: 'PIGGYVEST_WALLET_PAY_ENABLED',
  // Read-only daily stuck-transfer reconciliation report.
  daily_reconciliation: 'PIGGYVEST_RECONCILIATION_ENABLED',
  // Read-only degraded-health alerts (stalled setup, unconfirmed transfers).
  degraded_alerts: 'PIGGYVEST_DEGRADED_ALERTS_ENABLED',
} as const;

export type PiggyvestFeature = keyof typeof PIGGYVEST_FEATURE_FLAGS;
