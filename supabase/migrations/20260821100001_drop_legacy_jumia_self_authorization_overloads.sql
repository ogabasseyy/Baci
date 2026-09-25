-- Drop obsolete persist_jumia_self_authorization overloads so only the
-- ten-argument business-client contract remains callable by authenticated
-- integrations managers.

DROP FUNCTION IF EXISTS public.persist_jumia_self_authorization(
  uuid, text, text, timestamptz, text[], text[], text[], text[]
);

DROP FUNCTION IF EXISTS public.persist_jumia_self_authorization(
  uuid, text, text, timestamptz, timestamptz, text[], text[], text[], text[]
);
