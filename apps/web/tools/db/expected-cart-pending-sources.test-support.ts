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
    sha256: '045710bcad367696aaece46bdef78ffc7318819e1f9f7b1933c14fc6b49775e7',
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
    sha256: '18d360f43cd3ecd74d3369b80b72c583269e60a12522a01543456e41946c5360',
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
] as const;
