-- Only the claim-checked discovery consume contract may remain callable.
-- The pre-claim overload could delete a discovery without proving ownership
-- of its active claim token.
DROP FUNCTION IF EXISTS public.consume_jumia_self_authorization_discovery(
  uuid, uuid, text
);
