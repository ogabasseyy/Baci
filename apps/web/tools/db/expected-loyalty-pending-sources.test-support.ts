export const EXPECTED_LOYALTY_PENDING_SOURCES = [
  {
    repositoryPath:
      'supabase/migrations/20261009120000_enroll_customer_loyalty.sql',
    sha256: 'efe6f11dd3e46f036ee4bd768af201f49a4c331f966d1afa44f68e729f3b8e51',
  },
  {
    repositoryPath: 'supabase/migrations/20261009120001_loyalty_status.sql',
    sha256: '43fc12809f27bbd6ae44ecd576df7b5abcea6d0369fa4b70d6ff9553220cf4e8',
  },
  {
    repositoryPath:
      'supabase/migrations/20261009120002_award_purchase_points_row_lock.sql',
    sha256: 'd1c117e88c64abaa26dbadd3a9e2ca9cf73e80b78ac023e6dff43383ea841f4f',
  },
  {
    repositoryPath:
      'supabase/migrations/20261009120003_calculate_loyalty_tier_order.sql',
    sha256: '5c0bf8491e892ce8a8cca06af8f04d7511c7a234ef508543e9785984327d51aa',
  },
  {
    repositoryPath:
      'supabase/migrations/20261009120004_redeem_loyalty_reward.sql',
    sha256: '5cfbd6a367f50353574826df32efe0c1bc4d09d2ea91f317efebab93ed130a1a',
  },
] as const;
