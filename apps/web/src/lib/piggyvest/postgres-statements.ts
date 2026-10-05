import { CANCEL_PLAN_STATEMENTS } from './cancel-plan-statements';
import { CANCELLATION_RECOVERY_STATEMENTS } from './cancellation-recovery-statements';
import { COLLECTION_RECONCILIATION_STATEMENTS } from './collection-reconciliation-statements';
import { CUSTOMER_FUNDING_CAPABILITY_STATEMENTS } from './customer-funding-capability-statements';
import { DEVICE_CHANGE_STATEMENTS } from './device-change-statements';
import { DRAFT_CLOSURE_STATEMENTS } from './draft-closure-statements';
import { GOAL_LIFECYCLE_STATEMENTS } from './goal-lifecycle-statements';
import { GOAL_POLICY_STATEMENTS } from './goal-policy-store-statements';
import { PAYMENT_LEG_RECOVERY_STATEMENTS } from './payment-leg-recovery-statements';
import { PERIOD_RECOVERY_STATEMENTS } from './period-recovery-statements';
import { PROTECTED_OFFER_STATEMENTS } from './protected-offer-statements';
import { PIGGYVEST_PROVISIONING_RECOVERY_STATEMENTS } from './provisioning-recovery-statements';
import { PURCHASE_CURRENT_RECOVERY_STATEMENTS } from './purchase-current-recovery-statements';
import { PURCHASE_PREPARATION_STATEMENTS } from './purchase-preparation-statements';
import { PURCHASE_PRICING_STATEMENTS } from './purchase-pricing-statements';
import { RECONCILIATION_CASES_STATEMENTS } from './reconciliation-cases-statements';
import { SAVINGS_EXIT_EXECUTION_STATEMENTS } from './savings-exit-execution-statements';
import { SCHEDULE_STORE_STATEMENTS } from './schedule-store-statements';

export const PIGGYVEST_POSTGRES_STATEMENTS = {
  ...PAYMENT_LEG_RECOVERY_STATEMENTS,
  ...RECONCILIATION_CASES_STATEMENTS,
  ...PERIOD_RECOVERY_STATEMENTS,
  ...PROTECTED_OFFER_STATEMENTS,
  ...DEVICE_CHANGE_STATEMENTS,
  ...DRAFT_CLOSURE_STATEMENTS,
  ...CUSTOMER_FUNDING_CAPABILITY_STATEMENTS,
  ...COLLECTION_RECONCILIATION_STATEMENTS,
  ...PURCHASE_CURRENT_RECOVERY_STATEMENTS,
  ...PURCHASE_PRICING_STATEMENTS,
  ...SCHEDULE_STORE_STATEMENTS,
  ...CANCELLATION_RECOVERY_STATEMENTS,
  ...PURCHASE_PREPARATION_STATEMENTS,
  ...CANCEL_PLAN_STATEMENTS,
  ...SAVINGS_EXIT_EXECUTION_STATEMENTS,
  ...GOAL_LIFECYCLE_STATEMENTS,
  ...GOAL_POLICY_STATEMENTS,
  ...PIGGYVEST_PROVISIONING_RECOVERY_STATEMENTS,
  applySavingsLedger: {
    text: 'SELECT piggyvest_savings_ledger.apply($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::jsonb) AS result',
    parameters: 5,
    roles: ['piggyvest_staging_ledger_worker'],
  },
  readSavingsLedger: {
    text: 'SELECT piggyvest_savings_ledger.snapshot($1::uuid,$2::uuid,$3::uuid,$4::uuid) AS result',
    parameters: 4,
    roles: ['piggyvest_staging_ledger_worker'],
  },
  enqueueInbox: {
    text: 'SELECT inbox_id, outcome FROM piggyvest_staging.enqueue_inbox($1::uuid, $2::text, $3::bytea)',
    parameters: 3,
    roles: ['piggyvest_staging_intake'],
  },
  claimInbox: {
    text: 'SELECT inbox_id, claim_token FROM piggyvest_staging.claim_inbox($1::uuid, $2::integer, $3::integer)',
    parameters: 3,
    roles: ['piggyvest_staging_worker'],
  },
  quarantineInbox: {
    text: "SELECT piggyvest_staging.finish_inbox($1::uuid, $2::uuid, $3::uuid, 'unsupported', 0) AS outcome",
    parameters: 3,
    roles: ['piggyvest_staging_worker'],
  },
  resolveWalletMapping: {
    text: 'SELECT merchant_id, customer_id, goal_id FROM piggyvest_staging.resolve_wallet_mapping($1::uuid, $2::text, $3::text)',
    parameters: 3,
    roles: ['piggyvest_staging_worker', 'piggyvest_staging_provisioner'],
  },
  readScopedWalletMapping: {
    text: 'SELECT provider_wallet_id, provider_customer_id FROM piggyvest_staging.read_scoped_wallet_mapping($1::uuid, $2::uuid, $3::uuid, $4::uuid)',
    parameters: 4,
    roles: ['piggyvest_staging_provisioner'],
  },
  recordWalletGoalMapping: {
    text: 'SELECT piggyvest_staging.record_wallet_goal_mapping($1::uuid, $2::text, $3::text, $4::uuid, $5::uuid, $6::uuid) AS recorded',
    parameters: 6,
    roles: ['piggyvest_staging_provisioner'],
  },
  prepareProvisioning: {
    text: 'SELECT intent_id, outcome, status FROM piggyvest_staging.prepare_provisioning_intent($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::bytea)',
    parameters: 6,
    roles: ['piggyvest_staging_provisioner'],
  },
  claimProvisioning: {
    text: "SELECT intent_id, operation, merchant_id, customer_id, goal_id, encode(request_fingerprint, 'hex') AS request_fingerprint, claim_token, attempts, (extract(epoch FROM lease_expires_at) * 1000)::double precision AS lease_expires_at_ms FROM piggyvest_staging.claim_provisioning_intent($1::uuid, $2::uuid, $3::uuid, $4::integer, $5::text, $6::text)",
    parameters: 6,
    roles: ['piggyvest_staging_provisioner'],
  },
  recordProvisioning: {
    text: 'SELECT piggyvest_staging.record_provisioning_result($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::text, $7::text) AS outcome',
    parameters: 7,
    roles: ['piggyvest_staging_provisioner'],
  },
  expireProvisioning: {
    text: 'SELECT piggyvest_staging.expire_provisioning_claim($1::uuid, $2::uuid, $3::uuid) AS outcome',
    parameters: 3,
    roles: ['piggyvest_staging_provisioner'],
  },
} as const;
