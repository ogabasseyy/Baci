-- The scope helper is called by owner-run SECURITY DEFINER functions. The
-- deletion guard is invoked by its installed trigger. Neither is a public RPC.
REVOKE EXECUTE ON FUNCTION
  piggyvest_primary_card.assert_scope(jsonb, boolean, boolean),
  piggyvest_primary_card.block_unsettled_customer_deletion()
  FROM PUBLIC;
