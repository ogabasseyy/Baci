export const SCHEDULE_STORE_STATEMENTS = {
  readScheduleProposal: {
    text: 'SELECT piggyvest_schedule.read($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid) AS result',
    parameters: 7,
    roles: ['piggyvest_staging_policy_writer'],
  },
  writeScheduleProposal: {
    text: 'SELECT piggyvest_schedule.write($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::jsonb) AS result',
    parameters: 7,
    roles: ['piggyvest_staging_policy_writer'],
  },
} as const;
