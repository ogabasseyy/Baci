// Storefront-order migrations are kept separate so the aggregate fixture
// remains below the repository's 300-line modularity limit.
export const EXPECTED_STOREFRONT_ORDER_PENDING_SOURCES = [
  {
    repositoryPath:
      'supabase/migrations/20260828004000_storefront_order_idempotency_probe.sql',
    sha256: 'fa4bf84898c9c9881731f1387de6678e2afe575209b369fa1645a34d62afe292',
  },
  {
    repositoryPath:
      'supabase/migrations/20260827140000_enforce_storefront_order_delivery_metadata.sql',
    sha256: 'e3f521a3028544de7325a3203ce267ec8152d5eddd1e970e2b95d040c03b26f4',
  },
  {
    repositoryPath:
      'supabase/migrations/20260828091000_harden_storefront_order_rpc_context_and_replays.sql',
    sha256: 'b6efbc427ba4cab78826e7790495a9b5a668316e44626f7f96cd7ba53508a3d9',
  },
  {
    repositoryPath:
      'supabase/migrations/20260828101000_allow_legacy_quiz_award_order_context.sql',
    sha256: '6358f0b4b927dd3376ceca1f4f3c3b433146f62d68df39ab41de317e904f885e',
  },
  {
    repositoryPath:
      'supabase/migrations/20260828110000_prepare_storefront_order_hash_stamping.sql',
    sha256: '05007dffc62d3a57b844a99b856eed3f29d20055f232208d8dfc4a9caf1fb278',
  },
  {
    repositoryPath:
      'supabase/migrations/20260828110100_finalize_storefront_order_hash_stamping.sql',
    sha256: 'd47e7f8edaa2fb6d51f81b1cb13e02da78a268fb1b589f54c53a441efaba08e5',
  },
  {
    repositoryPath:
      'supabase/migrations/20260828120000_enforce_storefront_order_replay_route_context.sql',
    sha256: '19043684cc45788b8e4eecdd3bcef3d78ef68cff87c418d2cf2438dca4c3c5e9',
  },
  {
    repositoryPath:
      'supabase/migrations/20260828130000_scope_storefront_order_replay_route_context.sql',
    sha256: '6d50cefa7621d3f1085375ae22954a877dc5bb93a17ca09e1f6baa065de01af3',
  },
  {
    repositoryPath:
      'supabase/migrations/20260828150000_prepare_storefront_order_delivery_columns.sql',
    sha256: '462c99543a414b594f43407f54a97cb8785e914709883b6434b1668396b09815',
  },
  {
    repositoryPath:
      'supabase/migrations/20260828151000_enforce_storefront_airport_pickup_location.sql',
    sha256: '6cf6464ce3e36a23b2fa6d6b206b1165c7c6fdf3927bbbc7558fa418d3c9da40',
  },
  {
    repositoryPath:
      'supabase/migrations/20260828151100_prepare_storefront_order_delivery_metadata_persistence.sql',
    sha256: '596742042b56a606cf161006f68e8114325788cee04c6275fda2733f9509772a',
  },
  {
    repositoryPath:
      'supabase/migrations/20260828160000_persist_quiz_reserved_order_delivery_metadata.sql',
    sha256: 'bff3c706c64afef80bbde9012c4a50465022d33cb2053701ebf024dab9a67f6b',
  },
  {
    repositoryPath:
      'supabase/migrations/20260828160100_preserve_quiz_reserved_order_delivery_metadata.sql',
    sha256: 'c26332074863ab1cf4b5d92d7485a3793d087326c1f3f13e1a922a0deccd3a68',
  },
  {
    repositoryPath:
      'supabase/migrations/20260828160200_limit_quiz_reserved_order_delivery_validation_to_redemption.sql',
    sha256: '02d8c9c5f4eb0cdc83bc7d849cf3168cec43a99731f82646edac42f4bbef2fad',
  },
  {
    repositoryPath:
      'supabase/migrations/20260828170000_prepare_storefront_order_hash_version_context.sql',
    sha256: '59fe2125660db0085d6b1def95d56b6c8530bb99796ddc880fd7bbeb00343f28',
  },
  {
    repositoryPath:
      'supabase/migrations/20260828180000_persist_storefront_order_delivery_metadata_replay.sql',
    sha256: '45f5f06f2486fa9704d0092b03ef669647792f91a6977dce9159eec181289085',
  },
  {
    repositoryPath:
      'supabase/migrations/20260828190000_restore_storefront_order_delivery_metadata_enforcement.sql',
    sha256: '07f3127bd92fb004ef1eaa7f9558d9c5b2d73c6320512fd919ce37559b1c64f2',
  },
  {
    repositoryPath:
      'supabase/migrations/20260907180000_include_tracking_order_tax.sql',
    sha256: '1277d578605564b8adb9598ecc60457795ba5420b0c964f2c3d16d2041f962c5',
  },
  {
    repositoryPath:
      'supabase/migrations/20260907183000_index_friendly_order_tracking_merchant_slug.sql',
    sha256: 'a6ddf51d7323da3397b4ad0b3bfdf8bef672bab61484685426249e3453683e57',
  },
];
