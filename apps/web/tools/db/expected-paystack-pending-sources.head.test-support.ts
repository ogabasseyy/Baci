export const EXPECTED_PAYSTACK_PENDING_SOURCES_HEAD = [
  {
    repositoryPath:
      'supabase/migrations/20260811100000_manual_paystack_partial_reconciliation.sql',
    sha256: 'e9a10beaff84817e25b0f185d1aa672636ffcb052b8d19d678081cbaa9c5f09a',
  },
  {
    repositoryPath:
      'supabase/migrations/20260811110000_serialize_paystack_reference_claims.sql',
    sha256: '5967815ed18d787bc5f2a8d7036f7dbed4c603178454a9e418e5afb7be74b735',
  },
  {
    repositoryPath:
      'supabase/migrations/20260811120000_allow_reviewed_paystack_email_mismatch.sql',
    sha256: 'c92072e6b472fad64a64d22d9539f00422a6404a745e8a5febbeccebe478018a',
  },
  {
    repositoryPath:
      'supabase/migrations/20260811130000_serialize_wallet_paystack_reference_claims.sql',
    sha256: 'd938d44c8af908a099fb0d83bb292838d888738eeed5eabec90a288a091c1484',
  },
  {
    repositoryPath:
      'supabase/migrations/20260811135000_harden_paystack_chat_order_relationship.sql',
    sha256: '210c24070e7295dcdec19e10d33dd456a1dbc24891812cc74b4bfddeff808456',
  },
  {
    repositoryPath:
      'supabase/migrations/20260811140000_harden_paystack_manual_reconciliation_review_contracts.sql',
    sha256: '4ed01fb7657a37530a4bdb5de152b4bf869e4b2ddaf7bc04c29f7ca131207408',
  },
  {
    repositoryPath:
      'supabase/migrations/20260811150000_idempotent_paystack_reconciliation_retries.sql',
    sha256: '7cf4ca2faa5d170a6a1f4a0eb0e8cec10aee99a9e728fedbc906dfa288f0e195',
  },
  {
    repositoryPath:
      'supabase/migrations/20260811160000_index_paystack_reconciliation_retry_lookup.sql',
    sha256: 'c1c5724d6af11208bbb2880038676304cf5c1854cdaa9757b907866dc11e7466',
  },
  {
    repositoryPath:
      'supabase/migrations/20260811170000_require_paystack_reconciliation_operator_access.sql',
    sha256: '95f7ddb1c12eea9d152a99c137d20f73694d5d719eda63b72d4861fe6a99bfb4',
  },
  {
    repositoryPath:
      'supabase/migrations/20260811180000_fix_paystack_reconciliation_retry_balance.sql',
    sha256: '1ccd752c588696be6c221c46e4e0b5338046844ccad9d4a7076efe81ab659348',
  },
  {
    repositoryPath:
      'supabase/migrations/20260812100000_revoke_paystack_reconciliation_internal_versions.sql',
    sha256: 'd174bd434d72e16bbce09b2f146f3ffbdfe32cd22737ddc09f583d7aae007e02',
  },
  {
    repositoryPath:
      'supabase/migrations/20260812110000_harden_paystack_reconciliation_retry_scope.sql',
    sha256: 'bc70151fb7f1ebd60ce66cd620ab26d8422ab3eeb74f916c66dd4f3d77a4a6b3',
  },
  {
    repositoryPath:
      'supabase/migrations/20260813144355_reapply_allow_reviewed_paystack_email_mismatch.sql',
    sha256: 'a812eecb51e63a390599169e922739244587c6eeb6a5bab6bd0e2ee3b8934ce2',
  },
  {
    repositoryPath:
      'supabase/migrations/20260813192730_repair_harden_paystack_chat_order_relationship.sql',
    sha256: '27ef63c9838aa43f72f176453014371e9ff747a51ed8ee3dad21ecd8d4635794',
  },
  {
    repositoryPath:
      'supabase/migrations/20260814153213_repair_harden_paystack_manual_reconciliation_review_contracts.sql',
    sha256: '646271ab9d7519e8260d547ffc74b850c4fc19ba76a9f4ca20014aa16e27a97e',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825000000_allow_scoped_order_payment_account_updates.sql',
    sha256: 'c4ecc842f0cead588489605a3cb0cbb0fa5771d8bae962ed1d35934659573991',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825003000_scope_order_payment_account_mutations.sql',
    sha256: '9d7d1a95dd7044bd6b7cc39318d32334504fbb25c64182f2673d8e1217a18fe7',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825004500_authoritative_paystack_order_account_reservation.sql',
    sha256: '30956c99214721f1176c532088085d13824e8e5ae17322a1859305547afb82c4',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825010000_serialize_paystack_dva_cross_flow_aliases.sql',
    sha256: '90dc85f94f554151cfb3bf9eae6363fa1bf424ab636a71554f11f01c9e655ad8',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825013000_complete_paystack_dva_order_alias_lifecycle.sql',
    sha256: '2569b047b86a767b45b64ae24dfa4d90cc2dac4f5d7f652375c783e037f0989f',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825014500_expire_paystack_dva_alias_on_email_change.sql',
    sha256: '008b1ac3901a10a9e38690c05674943a53f42c99c0d47d60567edb19bec5bbb3',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825020000_reprovision_expired_paystack_order_aliases.sql',
    sha256: '0559aefa6e9af37502f5f2b3041add8580026fe7ee14dde6ed7cad5191ffa53e',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825141127_allow_order_view_dva_balance_refresh.sql',
    sha256: '6b415c957248566c0c6ac3a3d67b922b0b4642dc6e0cadff39dae6039ce2ce5b',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825142000_revalidate_paystack_order_email_at_reservation.sql',
    sha256: 'a9f9dcca1457f97446b23c5f3708309d65151885e66be0615d0ef980984c0e8d',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825143500_authorize_paystack_order_email_revalidation.sql',
    sha256: 'f71239850a075501047a15eb856660f993db4336b731707e76ce67c4b1e49933',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825150000_refresh_dva_balance_after_admin_order_edit.sql',
    sha256: '51541e188b76a5fafae1a5715f9d13f37eabd7d488bc02ace427ebdceb0cd995',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825151500_lock_admin_order_edit_before_dva_refresh.sql',
    sha256: '280a4ecefaf3934b2467252399cfc562e3699d7400b2b09486689a3bdc68d98a',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825182000_authorize_checkout_dva_reservation.sql',
    sha256: '815d979944b702ed2c2225ea9744f0a66e1f12bdd08614bd840ce3123073a695',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825200000_include_savings_in_dva_balance_refresh.sql',
    sha256: '4104ec214598f99436df51c357fcaff93725bc0a911e363ee845de5351f01cbf',
  },
];
