// Keep recently added identity and analytics migrations separate so the
// complete manifest binding remains below the repository's 300-line cap.
export const RECENT_PENDING_SOURCES = [
  {
    repositoryPath:
      'supabase/migrations/20260729195915_guard_merchant_social_media.sql',
    sha256: '54a9e1448588945f4fae6a758740ecf48be61e7536962438accf7c02cca854a3',
  },
  {
    repositoryPath:
      'supabase/migrations/20260730084051_repair_merchant_identity_guard_paths.sql',
    sha256: '960cae13fc8c97e50624cd1b4fc53fa785c7044f0dc233d87c6a057ffce82a28',
  },
  {
    repositoryPath:
      'supabase/migrations/20260730103000_enforce_merchant_updated_at_occ.sql',
    sha256: '3f6ca1a9570f072d934f7bcb8b7887371ccb3541b4e46d5c252e49102fedf1b5',
  },
  {
    repositoryPath:
      'supabase/migrations/20260730110031_skip_unchanged_guarded_social_updates.sql',
    sha256: '9be059cba5547494ce4f0db9220d8852d1bbe55a33f4ff327fa1dc7980d6b77e',
  },
  {
    repositoryPath:
      'supabase/migrations/20260730132000_add_scoped_merchant_analytics_config.sql',
    sha256: '883a1207a4aba986f59e4135dcdb932abc0965611eed016a331bf684cd68b47b',
  },
  {
    repositoryPath:
      'supabase/migrations/20260730144747_add_merchants_updated_at_trigger.sql',
    sha256: '621055c391934618eb5d45706bcc07894f772207507841cba0c22b45b2f97bf5',
  },
  {
    repositoryPath:
      'supabase/migrations/20260731190000_atomic_blog_post_product_links.sql',
    sha256: 'c0985aea612ecbd611213f7177b042c066c59cdac455f75ff162d3c32701a275',
  },
  {
    repositoryPath:
      'supabase/migrations/20260801000000_add_blog_post_product_position.sql',
    sha256: '59b08d027520cec131aabc6434b26174baa714b9e7407a316abd1781bae31343',
  },
  {
    repositoryPath:
      'supabase/migrations/20260801000500_preserve_legacy_blog_product_position_inserts.sql',
    sha256: '33c220545d2af71a65ca8647273997bdbf692bc505ecbceebb70011c17be4e10',
  },
  {
    repositoryPath:
      'supabase/migrations/20260811090000_repair_shipment_tracking_generation_order_id_ambiguity.sql',
    sha256: 'f50772f7fb481dc232078f4b87a8031ab746674e7ecd5fcf2bccb3099519b376',
  },
  {
    repositoryPath:
      'supabase/migrations/20260812090001_add_jumia_authorizations.sql',
    sha256: '35f8406e5e839b902b0766649a4ed0e2922a06360edea3ef29fbb7df94eadea2',
  },
  {
    repositoryPath:
      'supabase/migrations/20260813090000_dedupe_jumia_product_mappings_conflicts.sql',
    sha256: 'a0da88663ad92f55fc0931c7711425a6885484fc6ea76415a1639b211c30c695',
  },
  {
    repositoryPath:
      'supabase/migrations/20260813090001_jumia_product_mappings_nulls_not_distinct_index.sql',
    sha256: 'c80ccbe68c0a7dd873862867865206de97042cfe1d9ac92ee61bbac23d1a355e',
  },
  {
    repositoryPath:
      'supabase/migrations/20260813090002_jumia_product_mappings_nulls_not_distinct_constraint.sql',
    sha256: '64f7741e3b82d73f3f6b4fa91be801cb6c78b953cf150bd263aa5b3b0bc00148',
  },
  {
    repositoryPath:
      'supabase/migrations/20260813100600_fix_jumia_authorization_rotation_and_connect.sql',
    sha256: '43e7c94a4b92024bc93776b4b19667f6f941e52485f88339e6de7ef33411ca0b',
  },
  {
    repositoryPath:
      'supabase/migrations/20260813110000_fix_jumia_connect_duplicates_and_worker_rotation.sql',
    sha256: 'f15a292b6a774f2b67e04c80f5035221a74ca849f52ee2b0b229631103f74b1e',
  },
  {
    repositoryPath:
      'supabase/migrations/20260813120000_jumia_oauth_marketplace_key_backfill.sql',
    sha256: 'e4bfea9d6883fcd64a9ef9752f0f48a5c4c27389445b21bafb3e1ba04e1bb43e',
  },
  {
    repositoryPath:
      'supabase/migrations/20260813120100_jumia_product_mappings_marketplace_key.sql',
    sha256: 'ba0af6a1a50a8a295cd3cfd8e143f2ae2041f3293c49ade914240715d38e90f8',
  },
  {
    repositoryPath:
      'supabase/migrations/20260813120200_jumia_product_mappings_marketplace_unique_index.sql',
    sha256: '7c21a9fe39156b97b06c9611a6ec5c37e7f9866bff37d74b97fe0bd45389c306',
  },
  {
    repositoryPath:
      'supabase/migrations/20260813120300_jumia_product_mappings_marketplace_unique_constraint.sql',
    sha256: 'ac826dcdc056d5d5f89e4c1933391459ea38f1f2be835734765d9b1fbdcd5f17',
  },
  {
    repositoryPath:
      'supabase/migrations/20260813120400_fix_jumia_persist_all_active_and_authorization_rls.sql',
    sha256: '888841dc25e05537686053a74c2ef6f292f8ecdcf90abeefabf79fdd85699700',
  },
  {
    repositoryPath:
      'supabase/migrations/20260813120500_jumia_authorization_rotation_compare_and_swap.sql',
    sha256: '23ddc4d0c743c42650fc2afb8635e67871182cb33377dddea80ecad90a31b029',
  },
  {
    repositoryPath:
      'supabase/migrations/20260814143000_jumia_self_authorization_discoveries.sql',
    sha256: 'c9bbd7b5153cc7b472a8224d1a934729efe5ba4a458b46eb8a0fbb9a28baa949',
  },
  {
    repositoryPath:
      'supabase/migrations/20260814153213_repair_harden_paystack_manual_reconciliation_review_contracts.sql',
    sha256: '646271ab9d7519e8260d547ffc74b850c4fc19ba76a9f4ca20014aa16e27a97e',
  },
  {
    repositoryPath:
      'supabase/migrations/20260814170000_jumia_self_authorization_discovery_hardening.sql',
    sha256: '1dff3aa3be00a488d91786b549ac74cde85ac3218856df9dd404d0b103133ebe',
  },
  {
    repositoryPath:
      'supabase/migrations/20260814180000_load_jumia_authorization_credentials_worker_rpc.sql',
    sha256: '91a6fee3f274686b09d842ceca3485f1d54c38e3c4aac69c2b9adc96a5348aa3',
  },
  {
    repositoryPath:
      'supabase/migrations/20260814180100_jumia_product_mappings_staff_write_policy.sql',
    sha256: '4a81e43506fd9724ca11b8f7ef86ed4161e8cc2dac8b9e5ef2b199e933967359',
  },
  {
    repositoryPath:
      'supabase/migrations/20260814180200_jumia_authorization_refresh_lease_and_credential_rpc_fixes.sql',
    sha256: 'e6f90c9bc296bf5a2cd260a36099d01363215ca6f5db64bf86e5f911926d9b4a',
  },
  {
    repositoryPath:
      'supabase/migrations/20260814230000_repair_quiz_materialized_final_rankings_v2.sql',
    sha256: '7ef50c43690f895f5778d48c9715b450a866a1fd72af23f2e34b702d33e09ca1',
  },
  {
    repositoryPath:
      'supabase/migrations/20260815000000_repair_quiz_event_results_v2_deny_client_policy.sql',
    sha256: '6992ec9ddf3e5432869385a2e0c4ca2aa7058319841d071330135d1cb25680f1',
  },
  {
    repositoryPath:
      'supabase/migrations/20260815140000_jumia_review_followup_refresh_view_discovery_and_purge.sql',
    sha256: 'f9b97c4ed1e34d5ad9e34a9a62c2758330597a2982a73e8b3efc0de6509f01b0',
  },
  {
    repositoryPath:
      'supabase/migrations/20260815150000_jumia_restrict_credential_rotation_to_manage.sql',
    sha256: 'de501a2875f033aaaeaa2cef565f4b88f77e1f981cfa5c2070be18cd397fab30',
  },
  {
    repositoryPath:
      'supabase/migrations/20260818100000_jumia_self_authorization_refresh_expiry.sql',
    sha256: 'db77294ee08c07077c78222890bf750d9e7cf32e77fb0159f3d2e504a902d75a',
  },
  {
    repositoryPath:
      'supabase/migrations/20260818120000_jumia_oauth_handoff_ticket_rpcs.sql',
    sha256: '7d3dce35fd24a0e0f325857eede26ad0fa52eeeb022e83d98c994823a1bf0f68',
  },
  {
    repositoryPath:
      'supabase/migrations/20260818130000_allow_anon_jumia_discovery_purge_rpc.sql',
    sha256: 'dcdf450d195f59c417ee172716fc0315c89d938da966ef46c73b20e8c9ed8769',
  },
  {
    repositoryPath:
      'supabase/migrations/20260818140000_jumia_authorization_manage_load_compatibility.sql',
    sha256: 'e496722654c36b1b42d81d5e1d5e3064e45641fd47f15a217073538f92fba045',
  },
  {
    repositoryPath:
      'supabase/migrations/20260818150000_jumia_self_authorization_business_client_persistence.sql',
    sha256: 'd0e8e57379bc2480f430912ce952cb40d4258187881ff54bf2fceec06bf8a1fe',
  },
  {
    repositoryPath:
      'supabase/migrations/20260821100001_drop_legacy_jumia_self_authorization_overloads.sql',
    sha256: 'ff9932381c905e7fba773d31eafcd81dec05b5c97b145cbfe6099f3f1a8aa690',
  },
  {
    repositoryPath:
      'supabase/migrations/20260821100100_jumia_oauth_handoff_ticket_claim_finalize.sql',
    sha256: '2afe8a6a8c4bf8f6de32ac4a4b21eb63b271e47ea5229e28ffb0c6d6924e74a4',
  },
  {
    repositoryPath:
      'supabase/migrations/20260822100000_mark_reactivated_jumia_self_authorization_as_inserted.sql',
    sha256: 'e4b0d916cd49b542c2e7a4f3060b756bcebc7e9b5332a230277afa667fcb25a8',
  },
  {
    repositoryPath:
      'supabase/migrations/20260823100000_jumia_orphan_authorization_sweep.sql',
    sha256: 'b083e3e5682da5828f34d9593304d2371a1b38abb8020701e22e6ec1e1350f67',
  },
  {
    repositoryPath:
      'supabase/migrations/20260821171051_google_ads_connections_and_spend.sql',
    sha256: '1994ba5d58f278013d01a6b5f8ba0871f980a0f7223c0321875d4d5013df3c05',
  },
  {
    repositoryPath:
      'supabase/migrations/20260821174945_google_ads_secret_rpcs.sql',
    sha256: '6462c129ad02b0745800bad0ccbd81e6edb09b4af853c5de05bf0c1befc464b2',
  },
  {
    repositoryPath:
      'supabase/migrations/20260821180000_provider_neutral_ads_storage.sql',
    sha256: '1bc92dcee4cef48f4a30747ee378c81c3f0483e573d159df3b367bf7edee632d',
  },
  {
    repositoryPath:
      'supabase/migrations/20260821180001_harden_provider_neutral_ads_rpcs.sql',
    sha256: 'c5dc059fe41ebed2824b0d9b6275bd8d58b691c5cb561fc039bb80348834d563',
  },
  {
    repositoryPath:
      'supabase/migrations/20260821180002_meta_ads_reauth_status.sql',
    sha256: 'f0c8ee6d1f3b7b3e2eb06380c8be94fe797ed9781c1ba00d59b49ea1836b589c',
  },
  {
    repositoryPath:
      'supabase/migrations/20260821180003_expand_meta_ads_reauth_reason_allowlist.sql',
    sha256: '4312b9ad198bd16bb8bf20191e786e24a34a97f928da5e9031399f6a7da47960',
  },
  {
    repositoryPath:
      'supabase/migrations/20260821180004_snapchat_ads_oauth_and_disconnect.sql',
    sha256: 'eac8c22a9d2d2ad1decbde111f60921b880cf478f4123d3441b5e0e291ccb3ca',
  },
  {
    repositoryPath:
      'supabase/migrations/20260821180005_snapchat_ads_atomic_refresh_tokens.sql',
    sha256: 'c71e54d8a1ea2af6809ecc50d6e6582358806501eb851f17861dfab611f10359',
  },
  {
    repositoryPath:
      'supabase/migrations/20260821180006_provider_neutral_ads_oauth_state_nonces.sql',
    sha256: '7def866f396dced9ceb5c914e67b640c3765e25d9c59032bae78f10fa31d4dc3',
  },
  {
    repositoryPath:
      'supabase/migrations/20260821180007_harden_provider_neutral_ads_oauth_state_nonce_rpcs.sql',
    sha256: '55d645a37189cf63da021741d225888f6eb867c92f07bb0d05ffc3ee28b96f45',
  },
  {
    repositoryPath:
      'supabase/migrations/20260823190000_harden_ads_review_findings.sql',
    sha256: '3ba9981390574c940e3d90fb0ac3991bce39cb9625f5d0e31e2c185c88bbb56f',
  },
  {
    repositoryPath:
      'supabase/migrations/20260823200000_google_ads_reauth_status.sql',
    sha256: '7cc5b5c148990cb0cc0b7cb8ed98c6fe374dcc43fd3e7fef5db91c6563c92332',
  },
  {
    repositoryPath:
      'supabase/migrations/20260823210000_google_ads_reauth_clear_account.sql',
    sha256: 'dc328a575fba02e3fd64e470bcc328e27152d183e8c572f27c79d338e40e652d',
  },
  {
    repositoryPath:
      'supabase/migrations/20260823220000_google_ads_sync_consistency.sql',
    sha256: '70cf6954955961e3fcd923aac9c2512e54062ef5936d51c066faa3db23caeca3',
  },
  {
    repositoryPath:
      'supabase/migrations/20260824090000_replace_social_ads_spend_window.sql',
    sha256: '2e34f6488ad7bcd213fe9c08adf0353b789d7c6e0f017928276d64cd42cb5a5e',
  },
  {
    repositoryPath:
      'supabase/migrations/20260824100000_require_analytics_permission_for_ad_spend.sql',
    sha256: '822bf6c91081f0b36cd0568d85cd5f500bb91182d36d5fb9b35ba72e3491cde7',
  },
  {
    repositoryPath:
      'supabase/migrations/20260824110000_account_aware_ads_sync_marker.sql',
    sha256: '7b693e30176a0c500614d933161ba7e6dd03ec0468e250a3a99ac7d618c7b7b3',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825130000_index_snapchat_ads_oauth_state_nonce_fks.sql',
    sha256: 'e263dd84295faaba4aec24536626ea3040f972e1b36339e962a7adb864143182',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825150001_compare_and_set_ads_account_selection.sql',
    sha256: '318e0edccd8da2bf844bca55a60760cb96e1d9b04fc88b6bfc081c933a4cfc22',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825160000_bind_social_ads_spend_replacement_account.sql',
    sha256: '60a4613a121a6e24666a2d99c34a737d68934fd824c2ba20b50ef3a542ed1fc5',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825180000_restrict_ads_spend_replacement_to_service_role.sql',
    sha256: 'ada11f24b76ccbef17e39cb84fe009f00f617a7727973a4bf17fb586fcc3a6a8',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825183000_authorize_server_ads_spend_writes.sql',
    sha256: 'd3f849afe90cc671e19e18968538dabda817a266549d9f2d9e18751faf49af14',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825184500_make_social_ads_upsert_internal.sql',
    sha256: 'a5bb531d9d44d71af6bbe821e41efef929c2cb56c3146797c5b588b30ddc2877',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825190000_bulk_inventory_forecast_dashboard.sql',
    sha256: 'd38466b8daa79ac75dd96d0ee5e52039c62074cfaabf1ee326cbf3fb7f9f9a03',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825191000_revoke_legacy_google_ads_spend_upsert.sql',
    sha256: '313610b5bae49c42960a4ac516230f02227eaec78a601c31e8edc41f5fc04c75',
  },
  {
    repositoryPath:
      'supabase/migrations/20260826090000_restrict_ads_credential_rpcs_to_service_role.sql',
    sha256: 'a191c7045cb7e2efe1a160f0d7656f0cd433feb9a43f00fa48801fd1ffe91ca1',
  },
  {
    repositoryPath:
      'supabase/migrations/20260827110001_retire_snapchat_disconnect_spend_rpc.sql',
    sha256: '08c2b4e066a77294c8f3515a904beac9861e9273c2d7d856e5254d749dfb159a',
  },
  {
    repositoryPath:
      'supabase/migrations/20260827110100_preserve_zero_inventory_threshold.sql',
    sha256: 'a8fcac98895d9114ceef91a9dce08d461d63fe9b36ebd651686f61297eabdcb0',
  },
  {
    repositoryPath:
      'supabase/migrations/20260827110200_restore_inventory_forecast_effective_stock_priority.sql',
    sha256: 'be508f6123591624d3296d770a011f3ac6a4c4838ad10ad74f870a07aef2a2cd',
  },
  {
    repositoryPath:
      'supabase/migrations/20260827110300_restore_snapchat_refresh_state.sql',
    sha256: '3b12e4ae8b95685d7641dbc141d98df2ed188e2777b02de2234d43aedbae8dc6',
  },
  {
    repositoryPath:
      'supabase/migrations/20260826150000_restrict_ads_connection_select_to_view_permission.sql',
    sha256: 'c2b4d82902c24edb2f3d17b001c4646c9db787f92fa28ab0912a279b40f71c65',
  },
  {
    repositoryPath:
      'supabase/migrations/20260826160000_prioritize_out_of_stock_inventory_forecast.sql',
    sha256: '446ea5fe68b2d140405d810527ff8c5b8005b3ac73a607dfe85911a20c58b13b',
  },
  {
    repositoryPath:
      'supabase/migrations/20260827010001_use_effective_inventory_forecast_stock.sql',
    sha256: 'e2812d6c8e27dca4e546453d9ae80a8096d82f2602b741fd3408d320a144ab03',
  },
  {
    repositoryPath:
      'supabase/migrations/20260827020001_prioritize_inventory_status_before_limit.sql',
    sha256: 'f5bc90b0820af8924481b6518ee7949bedb6d73396a7522d8f8c4d24a47272db',
  },
  {
    repositoryPath:
      'supabase/migrations/20260827030001_mark_ads_sync_started.sql',
    sha256: '66d40ffc1bf3c3b5b0c893e5e497f8469c720e740d07bc18d68a76e2c1e85c4f',
  },
  {
    repositoryPath:
      'supabase/migrations/20260827040001_allow_null_ads_reauth_cas.sql',
    sha256: '200fb297f08db945d7f7a185f669c60f147a338406371df3aeef32412d36d1b6',
  },
  {
    repositoryPath:
      'supabase/migrations/20260827100001_google_ads_reauth_missing_refresh.sql',
    sha256: 'd35b075406091766d009071449cd197c15e777f46d778f7d049c7939bf35fa21',
  },
  {
    repositoryPath:
      'supabase/migrations/20260827120001_fence_ads_sync_runs.sql',
    sha256: '97c11c851442c4a12dd5079111d18fbce369a2a34fd3cc7c6be96e849df64938',
  },
  {
    repositoryPath:
      'supabase/migrations/20260827120100_fence_ads_spend_replacements.sql',
    sha256: 'bff3ca2da014926b884dca64fc6a3a7e28e9f611bce051d0e5380fc719943eed',
  },
  {
    repositoryPath:
      'supabase/migrations/20260827120200_order_ads_sync_run_starts.sql',
    sha256: '635152373f9ef17c17dec27eee616fe1ea2235a2a0cf907a40642135419eb5fc',
  },
  {
    repositoryPath:
      'supabase/migrations/20260828010000_server_owned_ads_sync_runs.sql',
    sha256: '89756694f550c5fb487f51b0267c67e15660e5ea93757bd5cee37f2e74ec8785',
  },
  {
    repositoryPath:
      'supabase/migrations/20260828090000_allow_staff_dashboard_preferences.sql',
    sha256: 'd983c2da2e003b816a7c21b7cca0fff235956fdc0d6d52a9a120cffad924492d',
  },
  {
    repositoryPath:
      'supabase/migrations/20260828100000_ads_sync_window_completion.sql',
    sha256: '5dad1e7b74d8f6d35b7849584b8241358aeec2a36dbe5882f159128bf246691b',
  },
];
