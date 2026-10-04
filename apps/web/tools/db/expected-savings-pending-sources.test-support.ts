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
      'supabase/migrations/20260912090000_piggyvest_staging_webhook_inbox.sql',
    sha256: 'e3528bda9bee0dd1d5bc4a908bf47d7deb8b2ebf1ee1bc054cf6dcb8a739af5b',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912090100_restrict_piggyvest_inbox_to_staging_registry.sql',
    sha256: '13a975b3c14489bc52d28abcb66705b437411a675b421e6d08cb6d2ddbf3dd6a',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912090200_piggyvest_staging_wallet_goal_mappings.sql',
    sha256: 'b171372fe6a356caae105b4983d6a46ac6cc57b510073e9a2c259e86d9424eb5',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912090300_piggyvest_staging_wallet_customer_consistency.sql',
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
    sha256: '63fc591f97a3231c050a4bd96fc13c77b5758c132767377ad29b6d0c6ba5305a',
  },
  {
    repositoryPath: 'supabase/migrations/20260912140100_goal_policy_scope.sql',
    sha256: 'dad8166518420742779e0a1bbca93bdaabdf127fc0bfe06bba4afabb18c27e66',
  },
  {
    repositoryPath: 'supabase/migrations/20260912140200_goal_policy_api.sql',
    sha256: 'adddc167467f9282925c381a91cd4a4884cb985349c0c1ce5e2b158399f8d9f4',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912140300_goal_policy_canonical_commands.sql',
    sha256: '0f9536df0216ebd26a75be9c0ad1b53c8d1f9ddb0eac1d1baff6e42147c0a24c',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912150000_goal_lifecycle_activation.sql',
    sha256: '7be6c78c9f7bca3d37fe0aa1b28bd55e9c71d112dc3afc46814ac001857a1a16',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912150100_goal_lifecycle_duration_consent.sql',
    sha256: '85d7fc5993bbb7f982dff03f9d09fe4d7216373b4352da9869b69bc12f54cf46',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912160000_cancel_plan_preparation.sql',
    sha256: 'b1b702dc20b46cb2e4f5e9ad18debc42a4dc6d773f9587918f0664497d6a64ad',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912160100_cancel_plan_legacy_isolation.sql',
    sha256: '470bee8c38a647a1ca09cc41badabafc10bfdd6a3f549e8bee510ccb2b6b4171',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912150200_goal_lifecycle_policy_ceremony.sql',
    sha256: '7f9113553ae543d1c32ecbace53712939328a9e889ceec3d08257100e40230cf',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912160200_cancel_plan_preserve_goal_snapshot.sql',
    sha256: '9922d854a2bfa7b3706b9a715d6631aa215a3296bc6b4758c225c0d19a750470',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912161000_cancellation_recovery_read.sql',
    sha256: 'b223093e286b288ae7cfed3b76bcc45bfa79d50557301e99f6dcb1a05b882cdc',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912162000_purchase_preparation_tables.sql',
    sha256: 'd7a8a3671ff3233da097c0deba8b56ca5ae908a9fed54ded510c9505cde3c0b7',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912162100_purchase_preparation_commands.sql',
    sha256: 'acb035ae118356307753200c4f0dc6a678ce2b278a9778c2a7f98d0db9136da3',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912164000_purchase_pricing_sources.sql',
    sha256: 'f1ee8116a260563fd531500019d05b2ce2f5c41b47d4a5f2f61b7ddea21aec71',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912164100_purchase_pricing_publish.sql',
    sha256: 'eac7374fd5e3777315da2ce4928e1d13e13f8569e33f67139090923d88b6e3af',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912164200_purchase_pricing_revalidation.sql',
    sha256: 'e66b0baff7357c39ba87c341ce59551f1fbeb4d979bd4600362c5c09d58ed997',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912165000_schedule_proposal_storage.sql',
    sha256: 'e47b30078e23e9f0e5ce42397df16b3aef186c4c0cab2cc21b9cbe084caa56ce',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912165100_schedule_proposal_commit.sql',
    sha256: '3149aa40018c69a888e627f80ff5d73680ff83c5c1304e8839076075eddf882f',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912170000_customer_funding_capability.sql',
    sha256: '1146d13f3a8187007b9a542f5d9ca3b9256353f18b3886e003795782a5fa4062',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912171000_purchase_current_recovery.sql',
    sha256: 'f5893cd714494113e66ebff4ed134870228452d08b3238faa5e77e29c4b6555d',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912172000_collection_reconciliation.sql',
    sha256: 'f3f29cfa7311498075ac16a207457a057945059d1880b41e18b0a20ac947d40c',
  },
  {
    repositoryPath: 'supabase/migrations/20260912181000_draft_closure.sql',
    sha256: '2a0976ab77b7f593452db7268ef1b35522f5fd83455b4c1d0023d24c9f72b113',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912181100_draft_closure_terminal_guards.sql',
    sha256: 'e3ebceb5b6b5beb69bc9a6fb9a844d9aaed6701f029aa6876b2c405349f5d58d',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912180000_device_change_versions.sql',
    sha256: '3b11dbf9a14815c4f916f8b3cf2ce75f4bb30bf32352cf27452b47ace933bc1e',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912180100_device_change_publication.sql',
    sha256: 'a97500ea39369ba979fe3347ef3f350a597d35f9b8d6ff3988261cfb19eab462',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912180200_device_change_confirmation.sql',
    sha256: 'b49c7d60c1912534a1ad81c69666078079b9e1c0a8b6ce2bdb2d150c0b4e5f12',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912180300_device_change_canonical_read.sql',
    sha256: 'fe2afd05709cfd6ef963c2d2cf4144c2fa3a05f5e170592d34e5503b4908a4c8',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912180400_device_change_pricing.sql',
    sha256: 'f30293f2b70a239682522ba922f90539a60a21c6e98a2170436871f634c6190d',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912180500_device_change_operations.sql',
    sha256: '609179e365704569762f53d0c70d89ddaeecf94b20d2767891f042c1ca9e216a',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912180600_device_change_lifecycle_funding.sql',
    sha256: '28ccf41a93f6fcbaf0455cf393c4992f349d8cb823cfea8e18b5b99fd9007dfc',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912182000_protected_offer_publications.sql',
    sha256: '8da9524405f3789d5bed641c6ba0c01eb0113dfb4284f8806ff4ab9498b46570',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912182100_protected_offer_publish.sql',
    sha256: '4166ce5b902e17929352e6934db28beaa59aea37f8b9ef92606a9283c6a1f89e',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912182200_protected_offer_pricing.sql',
    sha256: '0525d780cc2fb604adb164facb10e3eb811308e940c22a338d94cd0edbbccb5b',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912182300_protected_offer_quote_provenance.sql',
    sha256: 'd47cec538bd4813215d3dc2c9accd1be7c5172d223d7e56bada24eed3b98bd49',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912182400_protected_offer_catalog.sql',
    sha256: 'ee8f54c67405be717bf68d53f5c5a8927dbca5ff31267740ee5b841c419c0273',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912182500_protected_offer_schedule.sql',
    sha256: '58d06c17e91d18ec288e517ef30d43841ca493835c2e514dd0ff3a94e635df5a',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912183000_payment_leg_recovery.sql',
    sha256: '3f62ace9a4fd9734ae3295cca3914a0a0a944b1051938b3fed6571555814668d',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912184000_period_attribution_recovery.sql',
    sha256: '77968a2684d13b90d0b31d888a7ec928ec7ff31a82194d1ca6fd7823fcb1dab9',
  },
  {
    repositoryPath:
      'supabase/migrations/20260912185000_reconciliation_cases_read.sql',
    sha256: '5b078d9c73c9911533d7b6cbdec5eadbe7479408cb540bccbc1fdec82e847b15',
  },
  ...EXPECTED_CUSTOMER_SAVINGS_DRAFT_PENDING_SOURCES,
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
  ...EXPECTED_SAVINGS_ENGAGEMENT_PENDING_SOURCES,
] as const;
