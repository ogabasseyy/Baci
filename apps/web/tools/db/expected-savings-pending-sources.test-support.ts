import { EXPECTED_CUSTOMER_SAVINGS_DRAFT_PENDING_SOURCES } from './expected-customer-savings-draft-pending-sources.test-support';
import { EXPECTED_SAVINGS_ENGAGEMENT_PENDING_SOURCES } from './expected-savings-engagement-pending-sources.test-support';

export const EXPECTED_SAVINGS_PENDING_SOURCES = [
  {
    repositoryPath:
      'supabase/migrations/20260911204500_require_savings_goal_variant_when_product_has_variants.sql',
    sha256: '7e4131c4a50d3d0f65c39a58aa0d2adc57cdf41d867309cf9ffd8312a161e449',
  },
  {
    repositoryPath:
      'supabase/migrations/20260911210000_harden_savings_goal_exact_variant_selection.sql',
    sha256: '32ba8808d0a6052789d27b0a67b08571dc4f6de8186d39c9b4b7d2bd46e6ef6c',
  },
  {
    repositoryPath:
      'supabase/migrations/20260911210100_require_exact_savings_redemption_variant.sql',
    sha256: '7ca26bb667f746fae838e64977698b1be76f4a89c30da33ee8ca3f43feeda7be',
  },
  {
    repositoryPath:
      'supabase/migrations/20260911211000_close_savings_variant_and_redemption_gaps.sql',
    sha256: '028587d0545ed7cb70841e807570fb70d03747993990e2229464608439b15b83',
  },
  {
    repositoryPath:
      'supabase/migrations/20260911211100_require_finite_customer_savings_money.sql',
    sha256: '3744e8db34b6ae60b89a0def37aee179421ec2f4b2cc23c5d6552ac0cced9d0c',
  },
  {
    repositoryPath:
      'supabase/migrations/20260911211200_require_finite_savings_order_total.sql',
    sha256: 'a1ffe1946f0490d8495a08782f99a42153125999293050d53519844422be8df6',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912080000_piggyvest_staging_webhook_inbox.sql',
    sha256: 'e3528bda9bee0dd1d5bc4a908bf47d7deb8b2ebf1ee1bc054cf6dcb8a739af5b',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912080100_restrict_piggyvest_inbox_to_staging_registry.sql',
    sha256: '13a975b3c14489bc52d28abcb66705b437411a675b421e6d08cb6d2ddbf3dd6a',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912080200_piggyvest_staging_wallet_goal_mappings.sql',
    sha256: 'b171372fe6a356caae105b4983d6a46ac6cc57b510073e9a2c259e86d9424eb5',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912080300_piggyvest_staging_wallet_customer_consistency.sql',
    sha256: '0bca99e300631f6a1cfedab953f1105b446c9e3903fec08767fbda2eef10d151',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912100000_piggyvest_staging_provisioning_intents.sql',
    sha256: '6bfbb18bbd05dfd0095bbcbd5a80c537c7e3a28e1432c0110fdea6ba7fa96778',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912100100_piggyvest_staging_prepare_provisioning_intent.sql',
    sha256: 'c13307cd1f76c9354f403e599e6046d1d8be6ae0aee9a44364281674b7e9fd63',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912100200_piggyvest_staging_claim_provisioning_intent.sql',
    sha256: 'bef90681b9e7a7a5e1f5c805c4ca49014ce1983a0064e7d0db5360075f77711f',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912100300_piggyvest_staging_record_provisioning_result.sql',
    sha256: '6a84bf6d64df02293f8e0fab07a1b039f5b183d6967c697c405eeb337f6a7906',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912100400_piggyvest_staging_provisioning_recovery_references.sql',
    sha256: '43f7ddc87c39c06f10d2414dca23df3b04a1f6ac4a2cc58cc4dc64e57d49dd1e',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912100500_piggyvest_staging_provisioning_dispatch_customer.sql',
    sha256: 'ba47376761be313b4e1226e0e11633130940116dba4322a49c9c5a3453a13c2b',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912100600_piggyvest_staging_provisioning_account_guards.sql',
    sha256: '25554b310b4bc38b62c5266dfe4fcb15a1a0bb57e9304bc3351d69684807ec14',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912110000_piggyvest_provisioning_recovery_read.sql',
    sha256: 'ccd447be36f8301b092416156dec397d5afa61f25a0437800801f22d2f5526b9',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912110100_piggyvest_provisioning_recovery_observations.sql',
    sha256: '6daecbc0eca7f1d78a8a83da42dca1568c8bb528bd5192f75bee6044b10870db',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912110200_piggyvest_provisioning_recovery_verification.sql',
    sha256: '26bb10c4ad85040ea94ca430a854ac7391af76e5c41418482f5a73687c2f8272',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912110300_piggyvest_provisioning_recovery_confirmation.sql',
    sha256: '2676cd4b0f27fea38ab7c5f801d34c2ca5b097bf3ff3d32c61fea863d9290427',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912110400_piggyvest_created_customer_provenance.sql',
    sha256: '3fc443ce5741aa11b8ef67ba2aeb11e8708381a8c453b84c4affe5ea9cf2fb20',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912110500_piggyvest_provenance_verification.sql',
    sha256: '416331e0290d3ce631fb8f17dbf717494c0101efc58fb4affcf7f2094955e00f',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912110600_piggyvest_provenance_confirmation.sql',
    sha256: '6864f0da120b52d1e1829888d1c5f5a85d02129329737e8079d88c1e068f8aa5',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912120000_piggyvest_savings_ledger_tables.sql',
    sha256: '81dd0044ad42a0383c5e9f5ac13635a8da86193575e59eae741f61413706f6b2',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912120100_piggyvest_savings_ledger_guards.sql',
    sha256: '85332e149ae2ecfb04c24a96c011b1352f7931ecf0fc7fbf0a7682a73eff9340',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912120200_piggyvest_savings_ledger_apply.sql',
    sha256: '0f0392f1bb4242e9856f983ca071fa46c51daf55fdbd9b93d37ac03af657d381',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912120300_piggyvest_savings_ledger_snapshot.sql',
    sha256: '76369d9bfb0498deb7c9c6baf86494c4ec0f52373aa80bb3968cfc1ae2ef18b4',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912120400_piggyvest_savings_ledger_registry_gate.sql',
    sha256: '2c3f91f38ba3736727998e4d016d7b104ecf754d1a359133f27284dd48e0afd0',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912120500_piggyvest_savings_ledger_numeric_reference_casts.sql',
    sha256: 'd972db94d8be0b5315cf366cc1e11bdfef5f08357d8d25e13022f518a05ac77d',
  },
  {
    repositoryPath: 'supabase/migrations/20260912140000_goal_policy_tables.sql',
    sha256: '0e09901da7a0b6fbf0ce1e221948f934a91354dc3626f4999790c1dd8a157ef3',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912160000_cancel_plan_preparation.sql',
    sha256: '79a25e5b22dfa635d45aad0fe143d92bcd08f4010a7da734ac3814fba22219b6',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912162000_purchase_preparation_tables.sql',
    sha256: 'bf6d2204e53364b862c19dfc45d05b99078161b408ade9086528286abe81fc77',
  },
  {
    repositoryPath:
      'supabase/migrations/20260913130000_customer_savings_canonical_binding.sql',
    sha256: 'd885e0ab50aac24d75d745bf0e1a2cfd04024f62892665bb1c5f8c118259a153',
  },
  {
    repositoryPath:
      'supabase/migrations/20260913140000_customer_savings_canonical_isolation.sql',
    sha256: '29dabfca95e321518e1e37dd5fb9028e7034a4296bd4e122e6f88aba47cb5e78',
  },
  {
    repositoryPath:
      'supabase/migrations/20260926120001_piggyvest_staging_customer_mapping_read.sql',
    sha256: 'e194c86b5d5d5a9857d188369805da56fa4526ea8fe5267cc5ce63cd8232dcd9',
  },
  {
    repositoryPath:
      'supabase/migrations/20260926170000_piggyvest_interest_bridge.sql',
    sha256: '9f548fe5e3ef1bd33f654c959a4b87c40d50d37e12fb4894f59fb6b884211e76',
  },
  ...EXPECTED_CUSTOMER_SAVINGS_DRAFT_PENDING_SOURCES,
  ...EXPECTED_SAVINGS_ENGAGEMENT_PENDING_SOURCES,
] as const;
