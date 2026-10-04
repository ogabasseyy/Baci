import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPECTED_PENDING_SOURCES } from './expected-pending-sources.test-support';
import { EXPECTED_SAVINGS_ENGAGEMENT_PENDING_SOURCES } from './expected-savings-engagement-pending-sources.test-support';
import { supabaseHistoryReplayManifest } from './supabase-history-replay-manifest';

const root = path.resolve(__dirname, '../../../..');
const filenames = [
  '20260911204500_require_savings_goal_variant_when_product_has_variants.sql',
  '20260911210000_harden_savings_goal_exact_variant_selection.sql',
  '20260911210100_require_exact_savings_redemption_variant.sql',
  '20260911211000_close_savings_variant_and_redemption_gaps.sql',
  '20260911211100_require_finite_customer_savings_money.sql',
  '20260911211200_require_finite_savings_order_total.sql',
  '20260912090000_piggyvest_staging_webhook_inbox.sql',
  '20260912090100_restrict_piggyvest_inbox_to_staging_registry.sql',
  '20260912090200_piggyvest_staging_wallet_goal_mappings.sql',
  '20260912090300_piggyvest_staging_wallet_customer_consistency.sql',
  '20260912100000_piggyvest_staging_provisioning_intents.sql',
  '20260912100100_piggyvest_staging_prepare_provisioning_intent.sql',
  '20260912100200_piggyvest_staging_claim_provisioning_intent.sql',
  '20260912100300_piggyvest_staging_record_provisioning_result.sql',
  '20260912100400_piggyvest_staging_provisioning_recovery_references.sql',
  '20260912100500_piggyvest_staging_provisioning_dispatch_customer.sql',
  '20260912100600_piggyvest_staging_provisioning_account_guards.sql',
  '20260912110000_piggyvest_provisioning_recovery_read.sql',
  '20260912110100_piggyvest_provisioning_recovery_observations.sql',
  '20260912110200_piggyvest_provisioning_recovery_verification.sql',
  '20260912110300_piggyvest_provisioning_recovery_confirmation.sql',
  '20260912110400_piggyvest_created_customer_provenance.sql',
  '20260912110500_piggyvest_provenance_verification.sql',
  '20260912110600_piggyvest_provenance_confirmation.sql',
  '20260912120000_piggyvest_savings_ledger_tables.sql',
  '20260912120100_piggyvest_savings_ledger_guards.sql',
  '20260912120200_piggyvest_savings_ledger_apply.sql',
  '20260912120300_piggyvest_savings_ledger_snapshot.sql',
  '20260912120400_piggyvest_savings_ledger_registry_gate.sql',
  '20260912120500_piggyvest_savings_ledger_numeric_reference_casts.sql',
  '20260912140000_goal_policy_tables.sql',
  '20260912140100_goal_policy_scope.sql',
  '20260912140200_goal_policy_api.sql',
  '20260912140300_goal_policy_canonical_commands.sql',
  '20260912150000_goal_lifecycle_activation.sql',
  '20260912150100_goal_lifecycle_duration_consent.sql',
  '20260912150200_goal_lifecycle_policy_ceremony.sql',
  '20260912160000_cancel_plan_preparation.sql',
  '20260912160100_cancel_plan_legacy_isolation.sql',
  '20260912160200_cancel_plan_preserve_goal_snapshot.sql',
  '20260912161000_cancellation_recovery_read.sql',
  '20260912162000_purchase_preparation_tables.sql',
  '20260912162100_purchase_preparation_commands.sql',
  '20260912164000_purchase_pricing_sources.sql',
  '20260912164100_purchase_pricing_publish.sql',
  '20260912164200_purchase_pricing_revalidation.sql',
  '20260912165000_schedule_proposal_storage.sql',
  '20260912165100_schedule_proposal_commit.sql',
  '20260912170000_customer_funding_capability.sql',
  '20260912171000_purchase_current_recovery.sql',
  '20260912172000_collection_reconciliation.sql',
  '20260912180000_device_change_versions.sql',
  '20260912180100_device_change_publication.sql',
  '20260912180200_device_change_confirmation.sql',
  '20260912180300_device_change_canonical_read.sql',
  '20260912180400_device_change_pricing.sql',
  '20260912180500_device_change_operations.sql',
  '20260912180600_device_change_lifecycle_funding.sql',
  '20260912181000_draft_closure.sql',
  '20260912181100_draft_closure_terminal_guards.sql',
  '20260912182000_protected_offer_publications.sql',
  '20260912182100_protected_offer_publish.sql',
  '20260912182200_protected_offer_pricing.sql',
  '20260912182300_protected_offer_quote_provenance.sql',
  '20260912182400_protected_offer_catalog.sql',
  '20260912182500_protected_offer_schedule.sql',
  '20260912183000_payment_leg_recovery.sql',
  '20260912184000_period_attribution_recovery.sql',
  '20260912185000_reconciliation_cases_read.sql',
  '20260913120000_customer_savings_draft_storage.sql',
  '20260913120100_customer_savings_draft_commands.sql',
  '20260913130000_customer_savings_canonical_binding.sql',
  '20260913140000_customer_savings_canonical_isolation.sql',
  '20260915160000_customer_savings_hosted_draft_authorization.sql',
];
const engagementFilenames = EXPECTED_SAVINGS_ENGAGEMENT_PENDING_SOURCES.map(
  (source) => path.basename(source.repositoryPath)
);

describe('savings pending migration registration', () => {
  it.each(
    filenames
  )('pins the exact reviewed bytes of %s', async (filename) => {
    const repositoryPath = `supabase/migrations/${filename}`;
    const entry = supabaseHistoryReplayManifest.pendingSources.find(
      (source) => source.repositoryPath === repositoryPath
    );
    expect(entry).toBeDefined();
    expect(
      EXPECTED_PENDING_SOURCES.find(
        (source) => source.repositoryPath === repositoryPath
      )
    ).toEqual(entry);
    const bytes = await readFile(path.join(root, repositoryPath));
    expect(entry?.sha256).toBe(
      createHash('sha256').update(bytes).digest('hex')
    );
  });

  it('registers all engagement migrations in timestamp sequence with exact hashes', async () => {
    const engagementSources = supabaseHistoryReplayManifest.pendingSources
      .filter((source) =>
        engagementFilenames.includes(path.basename(source.repositoryPath))
      )
      .map(({ repositoryPath, sha256 }) => ({ repositoryPath, sha256 }));

    expect(engagementSources).toEqual(
      EXPECTED_SAVINGS_ENGAGEMENT_PENDING_SOURCES
    );
    for (const source of EXPECTED_SAVINGS_ENGAGEMENT_PENDING_SOURCES) {
      const bytes = await readFile(path.join(root, source.repositoryPath));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(
        source.sha256
      );
    }
  });
});
