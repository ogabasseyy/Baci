export const GOAL_LIFECYCLE_STATEMENTS = {
  prepareGoalLifecycleTerms: {
    text: 'SELECT piggyvest_goal_policy.prepare_lifecycle_terms($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::integer) AS result',
    parameters: 7,
    roles: ['piggyvest_staging_policy_writer'],
  },
  acceptGoalLifecycleTerms: {
    text: 'SELECT piggyvest_goal_policy.accept_lifecycle_terms($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid,$8::integer) AS result',
    parameters: 8,
    roles: ['piggyvest_staging_policy_writer'],
  },
  activateGoalLifecycle: {
    text: 'SELECT piggyvest_goal_policy.activate_lifecycle($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid) AS result',
    parameters: 7,
    roles: ['piggyvest_staging_policy_writer'],
  },
} as const;
