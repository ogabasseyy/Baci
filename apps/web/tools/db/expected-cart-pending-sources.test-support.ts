// Independently pinned bytes for the reviewed shared-cart migrations.
export const EXPECTED_CART_PENDING_SOURCES = [
  {
    repositoryPath: 'supabase/migrations/20261012050000_commerce_cart_core.sql',
    sha256: '05b64c67236c931660bff5c7ba064270f3d5220c2d296e334dc03316df4e8ef8',
  },
  {
    repositoryPath:
      'supabase/migrations/20261012050100_commerce_cart_roles.sql',
    sha256: 'a784e550a4cbfa9b3b8aff7c85e26074eddd41ad0376402425e89f56baf32d6f',
  },
  {
    repositoryPath:
      'supabase/migrations/20261012050200_commerce_cart_commands.sql',
    sha256: '19ced0268829a77105b735d74a03a13032b6f68e3e4dcbd027d846a4c6e37bf3',
  },
  {
    repositoryPath:
      'supabase/migrations/20261012050300_commerce_cart_legacy_migration.sql',
    sha256: 'bde35761168c508e7c5342a6c9961623076547bdee8be791da5d127a6e44ce87',
  },
  {
    repositoryPath:
      'supabase/migrations/20261012050400_commerce_cart_create_grant.sql',
    sha256: 'cc6fbca4196aa7e8e921b64e058056eb4b29051eae8500940af4915e50804b45',
  },
  {
    repositoryPath:
      'supabase/migrations/20261012050500_commerce_cart_handoff.sql',
    sha256: 'bf6f58becc8426f61c427d06126afa5ae38417b1c1964756a256a856fd5b9965',
  },
  {
    repositoryPath:
      'supabase/migrations/20261012050600_commerce_cart_order_binding.sql',
    sha256: 'f21fb269167127b568edda0fdbe47285c21de885c2585096564e0e641df6f4c7',
  },
  {
    repositoryPath:
      'supabase/migrations/20261013195818_commerce_cart_review_binding_guards.sql',
    sha256: '0df483ddbf8fc35f1fee9d1c352791b8dc285a45aa190ad9b43b104a6931aaeb',
  },
  {
    repositoryPath:
      'supabase/migrations/20261014070000_commerce_cart_broadcast.sql',
    sha256: '4c251e6b8769d7335f46351103fae4f9e919137c570cbb0f9718ae205bc89772',
  },
  {
    repositoryPath:
      'supabase/migrations/20261014120001_commerce_cart_account_continuity.sql',
    sha256: '62c726db284129e7b6875edf5b37ad32ce8c2da155e96eb4dbbbd7ff8b09bf8a',
  },
  {
    repositoryPath:
      'supabase/migrations/20261014120100_commerce_cart_mutation_permissions.sql',
    sha256: '044ee1cb004a1e891aa0d6ba09c4dd06fe5097cf927effb466a4275b03f43b1d',
  },
  {
    repositoryPath:
      'supabase/migrations/20261014120200_commerce_cart_account_tables.sql',
    sha256: 'a5ddcd36f7e642b9a005719d488322a0ea28a11687f5c8a2f268eded5890eb46',
  },
  {
    repositoryPath:
      'supabase/migrations/20261014120300_commerce_cart_account_functions.sql',
    sha256: '97816efa8074d015b2e6c80ca75f53bfa2c767276710c432959fbc72b53762ca',
  },
  {
    repositoryPath:
      'supabase/migrations/20261014120400_commerce_cart_handoff_merge_guards.sql',
    sha256: 'df6c83891b2f0a44bb083e6a289b9703e2e4d66ef6d17e91ed54167161dfbc97',
  },
  {
    repositoryPath:
      'supabase/migrations/20261014130001_agentic_idempotency_caller_scope.sql',
    sha256: 'e6da9a10fdc74c85ceda39ec663e7d5d9a44f3fbb78d39b72cdcb70cd1fac87e',
  },
  {
    repositoryPath:
      'supabase/migrations/20261014140001_agentic_cart_revision_guard.sql',
    sha256: '339aff778b52196f67bede94ac91caad38c99dcdecd03c864430c7756ebf444a',
  },
  {
    repositoryPath:
      'supabase/migrations/20261014141000_commerce_cart_checkout_lifetime.sql',
    sha256: 'bbfd4450f644a96fc330458e43a55b92dac8fe0bc7ff4014850349f55aadbca7',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015090000_commerce_cart_negotiation_policy.sql',
    sha256: 'e3c2ecc42985f5334dfa92ec5a0c1b33cefeff2dc97525a253d45a705d474b88',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015100000_commerce_cart_mutation_permissions_restore.sql',
    sha256: '1040e414b3a2b621f4434ae53b453c543c36d6c97c5129110daec459162c5403',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015110000_commerce_cart_handoff_issue_device_guard.sql',
    sha256: '8beebc0d6708ea016328389fcc6951a004c4a6a82e0aecd9494cc3c886b1674b',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015120000_commerce_cart_handoff_merchant_token.sql',
    sha256: '1fd9aaaf1c59c9ac571b4814c51656688a62328292132e2796e3f1d444e8c418',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015130000_commerce_cart_final_writer_guards.sql',
    sha256: '5c6f43749adf5fb3f021412e74ad07748c21633274077be91c299433b3ca373b',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015130100_commerce_cart_checkout_authority.sql',
    sha256: '801d0087333cca5b5411e8ad366e4f9499600614983527c3e6265cd9af389c01',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015130200_commerce_cart_account_lifecycle.sql',
    sha256: '2e8c12542278b53ab741670a836eb33138676bd6ce619f05f35b7c556d7a0441',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015130300_commerce_cart_handoff_canonical_merge.sql',
    sha256: '073f70f071e4e0304e7b65d5855ca6b730c913c4878ea7f5e6a435114b3ecbb9',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015130400_commerce_cart_verified_legacy_bridge.sql',
    sha256: '086520e534c9296686d56c351422aa48c51a7fbd5c0928552158d50a839e4eb3',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015130500_commerce_cart_condition_order_pricing.sql',
    sha256: '65ddd4fa9dc552f38621d59cc110b214b40ded4ea2546c0d98bfe608df3c051e',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015130600_commerce_cart_handoff_conflict_redaction.sql',
    sha256: '5146fe9b672edb663f9f5317e734c85d42272987da81800dac786bb663d70d3f',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015130700_commerce_cart_handoff_condition_prices.sql',
    sha256: '702e2424bd183811ec18c4ccd9f1b02bf088a5a90ee7c57d01b54a3c961aeee8',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015130800_commerce_cart_condition_offer_index.sql',
    sha256: 'cdfa79401ec49fbac855d557332c1e1a47ab0e95daeae4df6270dabd7ce3ba0f',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015140000_commerce_cart_claim_lock_order.sql',
    sha256: '7379cc79e417edc0274eb8f2273b5402b27f50fd8296d7405711c009b46034d1',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015141000_commerce_cart_mutation_lifetime_cap.sql',
    sha256: 'ee843a6161d262ced9a28382d1c54dd30c354cb16757b9514c4f6134049edc74',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015142000_commerce_cart_replace_attachment_identity.sql',
    sha256: '81fee784d8353589c88eeb7473740aa156ecd101936e1497f68533ea0dda0874',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015143000_commerce_cart_handoff_attachment_lifetime.sql',
    sha256: 'c8afa8af324bcb1f362f4ec38f87508bfca8f11494909ce39e3e9c993b13a224',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015144000_commerce_cart_checkout_add_identity.sql',
    sha256: 'f75a4cc62b3cf208fafd649bcbca81378e927676277c184ca5ad19b11fa77b12',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015145000_commerce_cart_checkout_complete_vouchers.sql',
    sha256: 'f7412c40a4fd9fd6deccadbe42e714ab34dfa8529588b210f4aaf5080d8e1574',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015150000_commerce_cart_agentic_checkout_economics.sql',
    sha256: '3a12b353ddeb98ef8dd2e49773c29b5adfab08ab7cc3f9ecb40c624fbd8e3089',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015151000_commerce_cart_partial_voucher_binding.sql',
    sha256: 'a5e398ad3aa10a72c12b0367f768090371f64c1ac25a10387f05f423eea43141',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015152000_commerce_cart_voucher_pair_writers.sql',
    sha256: '6d8c0c3983a5bd66c790c784e6777ea34f532d259a87411b932508911e8ef5f9',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015153000_commerce_cart_terminal_purge.sql',
    sha256: 'd4a8a00ff18b8a6f8d213c5ff15b663fd26c13bab33f98c98eae20b31da1673b',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015154000_commerce_cart_terminal_purge_schedule.sql',
    sha256: '8b728bc442a40e066a216a9365d54eed854b7233dfc85ae8e4bc1d3615a6decc',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015155000_commerce_cart_handoff_partial_pairs.sql',
    sha256: '6eb6d2b65d660c0c15039ce2c32247db5cff87cc16ee21cfe19da2a28bd37577',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015156000_commerce_cart_grant_operations.sql',
    sha256: 'ad86c52674381b1cff70d0a3cd0d2e659ef2014fd8bfaf991739dc6c11f54680',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015157000_commerce_cart_worker_outbox_scope.sql',
    sha256: '1401e4b4264bc4b071fe8c173d0eee8c8c3635b998d42108563c918ed3d84947',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015158000_commerce_cart_grant_expiry.sql',
    sha256: 'b379eedf274c10cf95cd7746fa2975cb5473bc5b6a113d31639e51287d4834ad',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015159000_commerce_cart_purge_search_path.sql',
    sha256: '3dcd0cae27a9dedfac0c66f3129c51a112412c849c43615e0d89df91b26b4f5e',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015160000_commerce_cart_redeem_grant_expiry.sql',
    sha256: 'bc38b2ad4dae7d8122b551d6cc8f17c524a030bce435c2d13d170832fbd5be15',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015161000_commerce_cart_retirement_retention.sql',
    sha256: '19b940c7eb912ef33f7d53a9e55eeb35687f7ffb9e38cc89adb2f8062e137807',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015162000_commerce_cart_terminal_purge_unschedule.sql',
    sha256: '0d4c49c32a8ee9958432bb10709cf08ace78e4bd4dddf47f8efab4021c268cde',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015163000_commerce_cart_cleanup_bounded.sql',
    sha256: '0acf41daf6adb0ceeb8067a6411e365dea41d18c76bf4c4c8ec61f63d4e9a71d',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015164000_commerce_cart_cleanup_indexes.sql',
    sha256: '691dd65d9ec4e73c082d0bb2e3c99a2f750f4ade01c1e004dada790edb6c1d1d',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015165000_commerce_cart_receive_receiver_only.sql',
    sha256: 'f186af4294f328834e1a4651f7d79d39771c3b36146f75d7e815414563f42b15',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015166000_commerce_cart_receiver_predicate_split.sql',
    sha256: '52e8e8bc0500a8a5972cdfd9376d150d710c9ed52da94f4459a8698546777b47',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015167000_commerce_cart_merge_chosen_quantity.sql',
    sha256: '7c3b871105c81650acc03259980e63511fd650eb260cd144b1873a5569497abe',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015168000_commerce_cart_handoff_preview_raw_token.sql',
    sha256: 'c3496ac2cbfac992a9e8838b3fa73de12948a7e927cf7bd23708d8827ba5e05f',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015169000_commerce_cart_canonical_feature_guard.sql',
    sha256: 'c9be95c1f8543a906fff9d274bc3267f0b7e057bfcdafcd2b640b954d20a1e1c',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015170000_storefront_checkout_replay_snapshot.sql',
    sha256: '64cf458058b059e3bb7b1086c27fd4fbace85a282efcca54a315b0cd5f1b94a5',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015171000_commerce_cart_legacy_bridge_lane_metadata.sql',
    sha256: '7b3aa2df21c8dcf721d1e1c454a968a4d8187bc384b9d40f5f21a4b411e52a10',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015172000_commerce_cart_handoff_preview_token_param.sql',
    sha256: '0b98ece36e95fc52409b2df19cb2c253810ca3ce600ef92a1beea0c3e550aa2e',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015173000_commerce_cart_recovery_marker_clear.sql',
    sha256: '9658b35c6c5526330a2d6de10ea0edebb8a773ef9096d3668de02c5dab6a6a2b',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015174000_commerce_cart_agentic_variant_read.sql',
    sha256: 'cfac15e5095c3c1ab86e8c5dbe3df13cba1b664117e101427d984d6229c6e111',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015175000_commerce_cart_variant_predicate_columns.sql',
    sha256: '61bf7decee64378efbaa83a4526af9132894cc1f02627898fc0c8027dddf8a13',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015176000_storefront_replay_snapshot_service_role.sql',
    sha256: '5c1a4c2ebbb2f035c2a29fcc08a42c3fe9a8ac322814b716b4b240aadf8f713c',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015177000_commerce_cart_feature_guard_nonarray.sql',
    sha256: '66953c8fe758b391d0ad3f556e254ec9226a7118ff097fd7b2c4fa088d4da6e8',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015178000_storefront_replay_snapshot_minimized.sql',
    sha256: '5b3133ba19edf4fe9055b6ec38911f83a3ca5bc745e7e1705ed434e0c5b9f0e7',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015179000_commerce_cart_shared_clear_guard.sql',
    sha256: 'e8ac84a19d4c6eecabbf4f3c8eb0ba874c572c80abfd3c75e0b166e455078514',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015179500_agentic_merchant_context_rpc.sql',
    sha256: '9024f155e42a2dae8ede9bbc99c3a94ff1a99e79e0dda1ccead90e31f1ff8775',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015179800_agentic_merchant_context_projection.sql',
    sha256: '5b6b5f67c29da16c11de1e822171c009a542fba7402c804164cdb4e5a85d07da',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015179900_agentic_merchant_context_no_subaccount.sql',
    sha256: '3a042e18d70fab10c27157d3e1a76fd1e9f1cc040b1d590f41a40b44a23aa724',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015179910_commerce_cart_zero_negotiation.sql',
    sha256: '7a1978c15a6b950f0523be6af8b7b1b585263bf5b9caed9c5b0fa3255240d456',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015179920_commerce_cart_handoff_union_award_lanes.sql',
    sha256: '8720d2fcb212cecae8251149c742f26037be3be6026b064a99dbfa244afc44cc',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015179930_storefront_replay_snapshot_uuid_key.sql',
    sha256: '3eda97b1b86ad5c115ba59369ced9adbb0ed860eb370fe3dc66911d2babdcdbb',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015179940_commerce_cart_bootstrap_insert_shape.sql',
    sha256: '18c9f8a716d76e128b5f9e5e5e78f238de32b636f26960cee66bfbea03066948',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015179950_commerce_cart_purge_search_path.sql',
    sha256: 'a932dd28d307c05615efd20681fabbe5645db48c4bcae65be93df80ebef9371f',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015179960_commerce_cart_creation_receipt_insert_revoke.sql',
    sha256: 'b4fae501862cedd5524270a69da3aac73152472cce7c9c8e9ed7d725d3911a2b',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015179970_commerce_cart_checkout_snapshot_zero_negotiation.sql',
    sha256: 'c552a2f32ca74cfd3355d894e0309f35365501e201667f67352a561ae3780c78',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015179980_storefront_replay_snapshot_mobile_key.sql',
    sha256: 'bf4515caa8ae70caf280ccd3460700b0250d037f432323b5a7012768b5eb6aa4',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015179985_storefront_replay_snapshot_route_context.sql',
    sha256: '631d7f35574032794782fb92ee59acfde76cec3507bd12cf9ef9526f0776dc53',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015179990_commerce_cart_scoped_preview.sql',
    sha256: 'def74960cc4b29503571d1661ae1761f7d7dbcad907bf23c31a57b3fe93f2a2c',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015179995_agentic_merchant_context_authority.sql',
    sha256: '7df4ef837ced6c83d6966ed7d2b8abe9bb479cfb5ad61203799d49d4947cf42b',
  },
  {
    repositoryPath:
      'supabase/migrations/20261015179997_commerce_cart_binding_loyalty_variant.sql',
    sha256: 'e39029891698b4ad029a6df2fb1a34d3d2815fb5e94b9b76246319d2299eaa4d',
  },
  {
    repositoryPath:
      'supabase/migrations/20261019172000_commerce_cart_offer_variant_columns.sql',
    sha256: '5fb1d9e34ce342494e53963a9160cc9ea4ada5c3f4338069b2e3fac18afc4ea1',
  },
  {
    repositoryPath:
      'supabase/migrations/20261019183000_commerce_cart_default_variant_predicate.sql',
    sha256: 'aed3970d9bc780233090c7d8c68e7f644a353c67017f6ccf9ffba6099bdf38b4',
  },
  {
    repositoryPath:
      'supabase/migrations/20261020042734_storefront_shared_cart_public_hints.sql',
    sha256: 'bf95a8674a8e78572f9ccdb353cf52ad498833099cd9dbb97a01362a8b35f07b',
  },
  {
    repositoryPath:
      'supabase/migrations/20261022001000_mcp_guest_oauth_records.sql',
    sha256: '1933f6b25b8731fe2526a7832e8b78311faaff81c57c1d82e5f71bdccfe41a1b',
  },
  {
    repositoryPath:
      'supabase/migrations/20261022010357_mcp_guest_oauth_cart_ownership.sql',
    sha256: '8345827fda4473ba394f7dedf1bf57ef5fe164ed6b3f60e093dbc402b0516b5b',
  },
  {
    repositoryPath:
      'supabase/migrations/20261022060000_mcp_guest_oauth_request_scope.sql',
    sha256: '51314f504550d5de548995e6a889001aea8355fb7515b652aec05efe452f7650',
  },
  {
    repositoryPath:
      'supabase/migrations/20261022060100_mcp_guest_oauth_capacity.sql',
    sha256: '9db3b090e5fec157850512442dc3d4ac6cb6f8a93f9a7db471f6b0da10451516',
  },
] as const;
