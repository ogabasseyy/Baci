-- PiggyVest S5b: withdraw the authorizer login's access to the cancel and
-- complete PIN-proof spend point.
--
-- The goal cancel and complete proofs are not issued by the web route any
-- more (it refuses them with PIN_ACTION_NOT_AVAILABLE). Until S6/S7 bind those
-- proofs to a server-issued per-attempt operation id, the database must not
-- let the authorizer login spend them either. S6/S7 will re-grant EXECUTE.
-- Funding is unchanged: it goes through reserve_savings_with_pin.
BEGIN;

REVOKE EXECUTE ON FUNCTION piggyvest_primary.consume_goal_pin_proof(jsonb, uuid, text, text)
  FROM piggyvest_primary_authorizer;

COMMIT;
