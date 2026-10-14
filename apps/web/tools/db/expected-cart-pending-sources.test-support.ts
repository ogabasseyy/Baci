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
    sha256: '8f7ee39347f057ebd0a12dbe6601c9f8d20e4392621ca7d4d2fd691fecbee192',
  },
  {
    repositoryPath:
      'supabase/migrations/20261012050300_commerce_cart_legacy_migration.sql',
    sha256: '8c2093f1c9fe491fe9762138580294bba13858c8e7620dad1bc6dd59e3169f3e',
  },
  {
    repositoryPath:
      'supabase/migrations/20261012050400_commerce_cart_create_grant.sql',
    sha256: 'c4156fc2a750e12964b4741d2fe91eca275766cd1d0d4293a4f50bfc9ccb5a60',
  },
  {
    repositoryPath:
      'supabase/migrations/20261012050500_commerce_cart_handoff.sql',
    sha256: '43bd085b601603e1a64ff0d4eb997ce026dc0a8f7d8482d2e01f291d30295806',
  },
  {
    repositoryPath:
      'supabase/migrations/20261012050600_commerce_cart_order_binding.sql',
    sha256: 'a0ce05b9cf6ecf219dbbb06d23af410b98ddfbfbc21ff4d090f890c47d6c4053',
  },
  {
    repositoryPath:
      'supabase/migrations/20261013195818_commerce_cart_review_binding_guards.sql',
    sha256: '5794a303af6b3678604e115e4c7796020b3b40ba4a0ef4ef7be692adba0fdb5d',
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
    sha256: '89f2e5651a603ba93e90e67fee1ba0dfd4aaa9815edfad55b64ca554e4331336',
  },
] as const;
