export const CUSTOMER_FUNDING_CAPABILITY_STATEMENTS = {
  readFundingCapability: {
    text: 'SELECT piggyvest_goal_policy.read_funding_capability($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid) AS result',
    parameters: 6,
    roles: ['piggyvest_staging_policy_writer'],
  },
} as const;
