export const GOAL_POLICY_STATEMENTS = {
  stageGoalPolicy: {
    text: 'SELECT piggyvest_goal_policy.stage($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::jsonb) AS result',
    parameters: 6,
    roles: ['piggyvest_staging_policy_writer'],
  },
  acceptGoalPolicy: {
    text: 'SELECT piggyvest_goal_policy.accept($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid) AS result',
    parameters: 7,
    roles: ['piggyvest_staging_policy_writer'],
  },
  readGoalPolicy: {
    text: 'SELECT piggyvest_goal_policy.read($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text) AS result',
    parameters: 5,
    roles: ['piggyvest_staging_policy_writer'],
  },
} as const;
