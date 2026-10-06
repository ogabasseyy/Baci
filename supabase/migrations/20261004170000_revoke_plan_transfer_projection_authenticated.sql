BEGIN;
-- The plan-transfer projection RPC is SECURITY DEFINER and trusts
-- caller-supplied customer, merchant, amount, and provider-transaction
-- values without an auth.uid() check. Only the HMAC-authenticated webhook
-- worker (service_role) may execute it: any authenticated client that
-- obtains a goal's identifiers could otherwise mint completed
-- contributions and inflate another customer's goal balance.
REVOKE EXECUTE ON FUNCTION public.allocate_plan_transfer_contribution(uuid, uuid, bigint, text, text)
  FROM authenticated;
COMMIT;
