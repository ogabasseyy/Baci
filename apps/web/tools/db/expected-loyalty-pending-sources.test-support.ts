export const EXPECTED_LOYALTY_PENDING_SOURCES = [
  {
    repositoryPath:
      'supabase/migrations/20261010000001_enroll_customer_loyalty.sql',
    sha256: 'efe6f11dd3e46f036ee4bd768af201f49a4c331f966d1afa44f68e729f3b8e51',
  },
  {
    repositoryPath: 'supabase/migrations/20261010000002_loyalty_status.sql',
    sha256: '8e0fa4d3bdb82c2d9050d6e7fd608f45f5f4864fc40aea89a329da0520e666ad',
  },
  {
    repositoryPath:
      'supabase/migrations/20261010000003_award_purchase_points_row_lock.sql',
    sha256: '1455cda98466612eed64c42e126e74d2de8faf5c8107fc1627c3b3b645f447e3',
  },
  {
    repositoryPath:
      'supabase/migrations/20261010000004_calculate_loyalty_tier_order.sql',
    sha256: 'ab962bbb088e8bb947b0e2f3651ef46b04eb5e2425aa149923665a51072d08fb',
  },
  {
    repositoryPath:
      'supabase/migrations/20261010000005_redeem_loyalty_reward.sql',
    sha256: 'f41a4a19bbf0d4a3210fe6a2123694c36f2cd8fcbbf89c48ab803fa578b68981',
  },
] as const;
