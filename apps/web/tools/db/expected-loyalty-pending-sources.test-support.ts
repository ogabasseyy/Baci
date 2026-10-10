export const EXPECTED_LOYALTY_PENDING_SOURCES = [
  {
    repositoryPath:
      'supabase/migrations/20261010000001_enroll_customer_loyalty.sql',
    sha256: 'c2d691a8e9cd379d0601a2d84e3af93d434304e393cd4bcea4603a6cdae1f157',
  },
  {
    repositoryPath: 'supabase/migrations/20261010000002_loyalty_status.sql',
    sha256: 'f975d4b26643cec9b4c9f042f462acf842df01ac58372840b13a923d90b42960',
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
    sha256: 'c33db2a51fc865994501d4a275f6b21a442897ed92741eea207637d47f07c6f1',
  },
] as const;
