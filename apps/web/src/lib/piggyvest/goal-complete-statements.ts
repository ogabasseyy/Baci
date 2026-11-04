// The only SQL the goal complete flow may send. Executors allow-list these
// exact strings, so a caller can never run anything else through them.
export const GOAL_COMPLETE_STATEMENTS = {
  issue:
    'SELECT piggyvest_primary.issue_goal_complete($1::jsonb,$2::uuid) AS result',
  reserve:
    'SELECT piggyvest_primary.reserve_goal_complete_with_pin($1::jsonb,$2::jsonb,$3::text) AS result',
  manage:
    'SELECT piggyvest_primary.manage_goal_complete($1::jsonb,$2::uuid,$3::text,$4::bigint) AS result',
  status:
    'SELECT piggyvest_primary.read_goal_complete_status($1::jsonb,$2::uuid) AS result',
  readDispatched:
    'SELECT piggyvest_primary.read_dispatched_goal_complete($1::uuid,$2::text,$3::uuid) AS result',
  checkIssued:
    'SELECT piggyvest_primary.check_goal_complete_issued($1::jsonb,$2::uuid,$3::uuid) AS result',
  findByReference:
    'SELECT piggyvest_primary.find_dispatched_goal_complete_by_reference($1::uuid,$2::text,$3::text) AS result',
  settle:
    'SELECT piggyvest_primary.settle_goal_complete($1::uuid,$2::text,$3::jsonb) AS result',
  release:
    'SELECT piggyvest_primary.release_failed_goal_complete($1::uuid,$2::text,$3::jsonb) AS result',
  readPurchaseAlert:
    'SELECT piggyvest_primary.read_goal_purchase_request_alert($1::uuid,$2::text,$3::uuid) AS result',
  markPurchaseAlerted:
    'SELECT piggyvest_primary.mark_goal_purchase_request_alerted($1::uuid,$2::text,$3::uuid) AS result',
} as const;
