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
    sha256: '6f5c14509f02db75ca111e72a56db91f96aab3b76534ee6966d8d65086702ead',
  },
  {
    repositoryPath:
      'supabase/migrations/20261012050300_commerce_cart_legacy_migration.sql',
    sha256: '8c2093f1c9fe491fe9762138580294bba13858c8e7620dad1bc6dd59e3169f3e',
  },
  {
    repositoryPath:
      'supabase/migrations/20261012050400_commerce_cart_create_grant.sql',
    sha256: '844a3998025d860dcce7bdb12f8070698bd6f153e4a41ecef3d79ea583590f05',
  },
  {
    repositoryPath:
      'supabase/migrations/20261012050500_commerce_cart_handoff.sql',
    sha256: 'b08cfe548eb5cd2a5e18d1f8fe0b5a35fc268204eb9289b9749521d7ccc42c12',
  },
  {
    repositoryPath:
      'supabase/migrations/20261012050600_commerce_cart_order_binding.sql',
    sha256: 'a0ce05b9cf6ecf219dbbb06d23af410b98ddfbfbc21ff4d090f890c47d6c4053',
  },
  {
    repositoryPath:
      'supabase/migrations/20261013195818_commerce_cart_review_binding_guards.sql',
    sha256: '4bd0940cd16e661d3c551a64a01802f6d6272098307fc10cd5276eb2af4b4578',
  },
  {
    repositoryPath:
      'supabase/migrations/20261014070000_commerce_cart_broadcast.sql',
    sha256: '4c251e6b8769d7335f46351103fae4f9e919137c570cbb0f9718ae205bc89772',
  },
  {
    repositoryPath:
      'supabase/migrations/20261014120000_commerce_cart_account_continuity.sql',
    sha256: '62c726db284129e7b6875edf5b37ad32ce8c2da155e96eb4dbbbd7ff8b09bf8a',
  },
  {
    repositoryPath:
      'supabase/migrations/20261014120100_commerce_cart_mutation_permissions.sql',
    sha256: 'ad71e3a913474d2d931e5336fb7b50998e33c6ecd0610925e2881b3858fec932',
  },
  {
    repositoryPath:
      'supabase/migrations/20261014120200_commerce_cart_account_tables.sql',
    sha256: 'a5ddcd36f7e642b9a005719d488322a0ea28a11687f5c8a2f268eded5890eb46',
  },
  {
    repositoryPath:
      'supabase/migrations/20261014120300_commerce_cart_account_functions.sql',
    sha256: 'e9fc9195e89d6cd54992534e14d92ca328d619e0d53f7337a324f11d60ed3f20',
  },
  {
    repositoryPath:
      'supabase/migrations/20261014120400_commerce_cart_handoff_merge_guards.sql',
    sha256: 'df6c83891b2f0a44bb083e6a289b9703e2e4d66ef6d17e91ed54167161dfbc97',
  },
  {
    repositoryPath:
      'supabase/migrations/20261014130000_agentic_idempotency_caller_scope.sql',
    sha256: 'e6da9a10fdc74c85ceda39ec663e7d5d9a44f3fbb78d39b72cdcb70cd1fac87e',
  },
  {
    repositoryPath:
      'supabase/migrations/20261014140000_agentic_cart_revision_guard.sql',
    sha256: '339aff778b52196f67bede94ac91caad38c99dcdecd03c864430c7756ebf444a',
  },
  {
    repositoryPath:
      'supabase/migrations/20261014141000_commerce_cart_checkout_lifetime.sql',
    sha256: '89f2e5651a603ba93e90e67fee1ba0dfd4aaa9815edfad55b64ca554e4331336',
  },
] as const;
