export const EXPECTED_LOYALTY_PENDING_SOURCES = [
  {
    repositoryPath:
      'supabase/migrations/20261009120000_enroll_customer_loyalty.sql',
    sha256: 'f23b7d39a3e7644fec7b5cfee86b2ca1fab40f2886948b11e9f783e5d45aee3f',
  },
  {
    repositoryPath: 'supabase/migrations/20261009120001_loyalty_status.sql',
    sha256: '90f0e5dd94140836e5e3f09aae49824ae6bc1da35c9faccc6bf1e252ceb496de',
  },
  {
    repositoryPath:
      'supabase/migrations/20261009120002_award_purchase_points_row_lock.sql',
    sha256: 'a55b4edb726e2b1bb8f3a41ad4fcc41c059e4bc93fdc3cc5d607e82348cc30c7',
  },
] as const;
