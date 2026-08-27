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
] as const;
