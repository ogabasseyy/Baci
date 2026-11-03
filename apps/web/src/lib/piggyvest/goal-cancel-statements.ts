// The only SQL the goal cancel refund may send. Executors allow-list these
// exact strings, so a caller can never run anything else through them.
export const GOAL_CANCEL_STATEMENTS = {
  issue:
    'SELECT piggyvest_primary.issue_goal_cancel($1::jsonb,$2::uuid) AS result',
  reserve:
    'SELECT piggyvest_primary.reserve_goal_cancel_with_pin($1::jsonb,$2::jsonb,$3::text) AS result',
  manage:
    'SELECT piggyvest_primary.manage_goal_cancel($1::jsonb,$2::uuid,$3::text,$4::bigint) AS result',
  status:
    'SELECT piggyvest_primary.read_goal_cancel_status($1::jsonb,$2::uuid) AS result',
  readDispatched:
    'SELECT piggyvest_primary.read_dispatched_goal_cancel($1::uuid,$2::text,$3::uuid) AS result',
  settle:
    'SELECT piggyvest_primary.settle_goal_cancel($1::uuid,$2::text,$3::jsonb) AS result',
  release:
    'SELECT piggyvest_primary.release_failed_goal_cancel($1::uuid,$2::text,$3::jsonb) AS result',
} as const;
