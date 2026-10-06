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
  '20260912080000_piggyvest_staging_webhook_inbox.sql',
  '20260912080100_restrict_piggyvest_inbox_to_staging_registry.sql',
  '20260912080200_piggyvest_staging_wallet_goal_mappings.sql',
  '20260912080300_piggyvest_staging_wallet_customer_consistency.sql',
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
  '20260912160000_cancel_plan_preparation.sql',
  '20260912162000_purchase_preparation_tables.sql',
  '20260913120000_customer_savings_draft_storage.sql',
  '20260913120100_customer_savings_draft_commands.sql',
  '20260913130000_customer_savings_canonical_binding.sql',
  '20260913140000_customer_savings_canonical_isolation.sql',
  '20260915160000_customer_savings_hosted_draft_authorization.sql',
  '20260926120001_piggyvest_staging_customer_mapping_read.sql',
  '20260926170000_piggyvest_interest_bridge.sql',
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
