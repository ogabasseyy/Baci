export const EXPECTED_INVENTORY_PENDING_SOURCES = [
  {
    repositoryPath:
      'supabase/migrations/20260825111303_serialize_inventory_release_on_order.sql',
    sha256: 'a24c3bdd3f5fc8c87bcb878d12463f4bcfbc64553ebcd41d104ac3c30fcf4f28',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825123500_fail_closed_missing_stock_rows.sql',
    sha256: '754d41bb57151cd31b21937d5bc6b00397de43c6ff1070dd3725c37982866448',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825173500_authorize_serialized_inventory_claims.sql',
    sha256: '6e1d8936c5a69ab3c98825e93914a31fa9cf3689bd3984758e956fec1c0b7b7d',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825180500_authorize_inventory_confirmation.sql',
    sha256: '0e4c28c67751b4ceb90b75d937fb6a2cc569a325380d75a660e8696622c4b533',
  },
  {
    repositoryPath:
      'supabase/migrations/20260825185000_scope_confirmation_reclaims_per_item.sql',
    sha256: 'ab13510a0a7c14ac2e77d82a553cd3306f2ce0a15ffd0d0cf33304ae599bd91c',
  },
  {
    repositoryPath:
      'supabase/migrations/20260829001000_harden_serialized_inventory_release_reconciliation.sql',
    sha256: '8828e6216602d17d3d3670bbae4c78d38c37411872fb30584c27d7b970355834',
  },
  {
    repositoryPath:
      'supabase/migrations/20260828005000_preserve_order_fulfillment_on_idempotent_inventory_release.sql',
    sha256: 'cef378dbd30ab89303d04848d2ad18a76ebdf10ac8b9447ff3aa27861b4d81aa',
  },
  {
    repositoryPath:
      'supabase/migrations/20260828006000_harden_serialized_inventory_confirmation_order.sql',
    sha256: 'ecbf92f71656a7ac03a161226f410af3f1832c15f04d41be8b6da216ccd95dfe',
  },
  {
    repositoryPath:
      'supabase/migrations/20260828007000_project_confirmation_item_columns.sql',
    sha256: 'e64993fc7f9ac8f0a5bd113059f7564b45e6820ea4ff0516d3814e4fd9696573',
  },
  {
    repositoryPath:
      'supabase/migrations/20260828008000_harden_serialized_inventory_release_authorization.sql',
    sha256: '7f38c505b026f6db63cb83e3d21a50f87938f1e751462afbc5d57b683f514ece',
  },
  {
    repositoryPath:
      'supabase/migrations/20260828009000_harden_decrement_quantity_guards.sql',
    sha256: 'df90953c0193ac034ecac2a21e522acbfaf03f89d8b2c678f64fd471555db316',
  },
  {
    repositoryPath:
      'supabase/migrations/20260829002000_harden_serialized_inventory_release_ordering.sql',
    sha256: '21c58d3cf52fb2a17ce62214ab45eb89bac0952716c870c379e523746990f599',
  },
  {
    repositoryPath:
      'supabase/migrations/20260829003000_harden_confirmation_reservation_capture.sql',
    sha256: 'c627503e72ea8c412f5360ad8fa348a1f6c4dbc5a1bb32d8105f48fabeac57ea',
  },
  {
    repositoryPath:
      'supabase/migrations/20260828102000_harden_confirmation_idempotency.sql',
    sha256: '55c520f2519aa6400b59e5ece4258cb18a156d134ca982721e281e6dd9956e9a',
  },
  {
    repositoryPath:
      'supabase/migrations/20260828103000_fail_closed_null_stock_decrements.sql',
    sha256: '19695cf3098e07a02938a207d29845ff274fad37368302f91a83fe7b7406b2bb',
  },
] as const;
