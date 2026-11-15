// The only SQL the goal cancel interest forfeit may send (migration
// 20261112190514). Executors allow-list these exact strings.
export const GOAL_CANCEL_FORFEIT_STATEMENTS = {
  // Authorizer login, customer scope.
  claim:
    'SELECT piggyvest_primary.claim_goal_cancel_forfeit($1::jsonb,$2::uuid) AS result',
  manage:
    'SELECT piggyvest_primary.manage_goal_cancel_forfeit($1::jsonb,$2::uuid,$3::text) AS result',
  // Records the submit path's page about a hold (after the page).
  holdAck:
    'SELECT piggyvest_primary.ack_goal_cancel_hold($1::jsonb,$2::uuid) AS result',
  // Authorizer login, integration authority (the scheduled worker sweep):
  // parameters are integration id, environment, then the selection.
  workerList:
    'SELECT piggyvest_primary.list_goal_cancel_forfeit_work($1::uuid,$2::text,$3::integer,$4::boolean) AS result',
  // Records an emitted page (after the alert, never before).
  workerAck:
    'SELECT piggyvest_primary.ack_goal_cancel_forfeit_alert_worker($1::uuid,$2::text,$3::uuid) AS result',
  // Cancels held before anything was sent, and their page acknowledgement.
  workerHolds:
    'SELECT piggyvest_primary.list_goal_cancel_holds_worker($1::uuid,$2::text) AS result',
  workerHoldAck:
    'SELECT piggyvest_primary.ack_goal_cancel_hold_worker($1::uuid,$2::text,$3::uuid) AS result',
  workerClaim:
    'SELECT piggyvest_primary.claim_goal_cancel_forfeit_worker($1::uuid,$2::text,$3::uuid) AS result',
  workerRelease:
    'SELECT piggyvest_primary.release_goal_cancel_forfeit_worker($1::uuid,$2::text,$3::uuid) AS result',
  workerUnclaim:
    'SELECT piggyvest_primary.unclaim_goal_cancel_forfeit_worker($1::uuid,$2::text,$3::uuid) AS result',
  workerPosting:
    'SELECT piggyvest_primary.mark_goal_cancel_forfeit_posting_worker($1::uuid,$2::text,$3::uuid,$4::uuid) AS result',
  // Evidence login: the same four shapes the goal cancel evidence store uses.
  readDispatched:
    'SELECT piggyvest_primary.read_dispatched_goal_cancel_forfeit($1::uuid,$2::text,$3::uuid) AS result',
  findByReference:
    'SELECT piggyvest_primary.find_dispatched_goal_cancel_forfeit_by_reference($1::uuid,$2::text,$3::text) AS result',
  settle:
    'SELECT piggyvest_primary.settle_goal_cancel_forfeit($1::uuid,$2::text,$3::jsonb) AS result',
  release:
    'SELECT piggyvest_primary.release_failed_goal_cancel_forfeit($1::uuid,$2::text,$3::jsonb) AS result',
  // Records a page the evidence side emitted (after the alert, never before).
  ack: 'SELECT piggyvest_primary.ack_goal_cancel_forfeit_alert_evidence($1::uuid,$2::text,$3::uuid) AS result',
} as const;
