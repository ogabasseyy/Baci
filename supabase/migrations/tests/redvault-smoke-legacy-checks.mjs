import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkVerifiedCompletionConcurrency } from './redvault-verified-completion-concurrency.mjs';

// Runs the legacy verified-completion, fulfillment, and mid-chain checks,
// including the verified-completion concurrency probe.
export async function runSmokeLegacyChecks({
  directory,
  inventory,
  inventoryEnd,
  inventoryStart,
  migrations,
  port,
  root,
  sql,
}) {
  process.stdout.write(
    sql(readFileSync(resolve(directory, 'redvault-capture-hold.sql'), 'utf8'))
  );
  process.stdout.write(
    sql(
      readFileSync(
        resolve(directory, 'redvault-verified-completion-914.sql'),
        'utf8'
      )
    )
  );
  process.stdout.write(
    sql(
      readFileSync(
        resolve(directory, 'redvault-verified-completion-917.sql'),
        'utf8'
      )
    )
  );
  process.stdout.write(
    sql(
      readFileSync(
        resolve(directory, 'redvault-verified-completion-916-malformed.sql'),
        'utf8'
      )
    )
  );
  sql(inventory.slice(inventoryStart, inventoryEnd));
  process.stdout.write(
    sql(
      readFileSync(
        resolve(directory, 'redvault-verified-completion-916.sql'),
        'utf8'
      )
    )
  );
  process.stdout.write(
    sql(
      readFileSync(
        resolve(directory, 'redvault-fresh-approval-state-919.sql'),
        'utf8'
      )
    )
  );
  await checkVerifiedCompletionConcurrency(root, port, sql);
  process.stdout.write(
    sql(
      readFileSync(
        resolve(directory, 'redvault-verified-completion.sql'),
        'utf8'
      )
    )
  );
  process.stdout.write(
    sql(
      readFileSync(
        resolve(directory, 'redvault-postapproval-fulfillment-919.sql'),
        'utf8'
      )
    )
  );
  process.stdout.write(
    sql(
      readFileSync(
        resolve(directory, 'redvault-full-refund-fulfillment-hold-923.sql'),
        'utf8'
      )
    )
  );
  process.stdout.write(
    sql(
      readFileSync(
        resolve(directory, 'redvault-item-membership-921.sql'),
        'utf8'
      )
    )
  );
  process.stdout.write(
    sql(readFileSync(resolve(directory, 'redvault-fk-indexes-922.sql'), 'utf8'))
  );
  process.stdout.write(
    sql(
      readFileSync(
        resolve(directory, 'redvault-current-tree-replay.sql'),
        'utf8'
      )
    )
  );
  for (const filename of [
    '20260912092400_uba_redvault_atomic_order_creation.sql',
    '20260912092500_uba_redvault_refund_and_usage_safety.sql',
    '20260912092600_uba_redvault_transaction_capture_persistence.sql',
    '20260912092700_uba_redvault_assurance_currency_retry_guards.sql',
  ])
    sql(readFileSync(resolve(migrations, filename), 'utf8'));
  sql(
    "UPDATE private.uba_redvault_runtime SET commercial_terms = jsonb_build_object('campaign_dates', jsonb_build_object('starts_at', '2000-01-01T00:00:00Z', 'ends_at', '2999-01-01T00:00:00Z'), 'minimum_spend', jsonb_build_object('eligible_subtotal_kobo', 0), 'caps', jsonb_build_object('discount_kobo', 100000000), 'usage_limits', jsonb_build_object('usage_limit', NULL, 'usage_limit_per_customer', NULL), 'stacking', 'fixture', 'split_payments', 'fixture', 'funding_fees', 'fixture', 'refund_usage_restoration', 'fixture', 'operations_owner', 'fixture');"
  );
  sql(
    readFileSync(
      resolve(
        migrations,
        '20260912092800_uba_redvault_commercial_term_enforcement.sql'
      ),
      'utf8'
    )
  );
  sql(
    readFileSync(
      resolve(
        migrations,
        '20260912092900_uba_redvault_variant_condition_and_paystack_split.sql'
      ),
      'utf8'
    )
  );
  sql(
    readFileSync(
      resolve(
        migrations,
        '20260913090000_uba_redvault_recovery_and_booking_lock.sql'
      ),
      'utf8'
    )
  );
  sql(
    readFileSync(
      resolve(
        migrations,
        '20260913090100_uba_redvault_refund_settlement_reversal.sql'
      ),
      'utf8'
    )
  );
  for (const filename of [
    '20260913090200_uba_redvault_partial_refund_inventory_reconciliation.sql',
    '20260913090300_uba_redvault_remaining_capture_refunds.sql',
    '20260913090400_uba_redvault_attempt_persistence_and_replay_guards.sql',
    '20260913090500_uba_redvault_review_followups.sql',
    '20260913090600_uba_redvault_followup_hardening.sql',
  ])
    sql(readFileSync(resolve(migrations, filename), 'utf8'));
  for (const filename of [
    'redvault-atomic-order-924.sql',
    'redvault-usage-limits-925.sql',
    'redvault-refund-finalization-925.sql',
    'redvault-refund-inventory-925.sql',
    'redvault-transaction-persistence-926.sql',
    'redvault-verified-replay-926.sql',
    'redvault-current-tree-replay.sql',
    'redvault-followup-grants-926.sql',
    'redvault-assurance-currency-927.sql',
    'redvault-commercial-terms-928.sql',
    'redvault-variant-condition-paystack-split-929.sql',
    'redvault-refund-settlement-reversal-929.sql',
    'redvault-partial-refund-quantity-safety-932.sql',
    'redvault-attempt-persistence-904.sql',
    'redvault-review-followups-905.sql',
  ])
    process.stdout.write(
      sql(readFileSync(resolve(directory, filename), 'utf8'))
    );
  sql(
    readFileSync(
      resolve(
        migrations,
        '20260922232000_uba_redvault_checkout_summary_qualified_columns.sql'
      ),
      'utf8'
    )
  );
  process.stdout.write(
    sql(
      readFileSync(
        resolve(directory, 'redvault-checkout-summary-qualified-columns.sql'),
        'utf8'
      )
    )
  );
}
