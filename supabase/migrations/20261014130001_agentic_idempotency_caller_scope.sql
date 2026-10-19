-- Scope agentic idempotency receipts by verified platform caller as well
-- as tenant, route and key, so two agents under one merchant can never
-- replay each other's stored responses. Existing rows keep the empty
-- caller scope, matching callers that present no agent identity.
ALTER TABLE public.agentic_idempotency_records
  ADD COLUMN IF NOT EXISTS agent_id text NOT NULL DEFAULT '';

DROP INDEX IF EXISTS public.agentic_idempotency_records_key_idx;

CREATE UNIQUE INDEX IF NOT EXISTS agentic_idempotency_records_caller_key_idx
  ON public.agentic_idempotency_records (merchant_id, route, agent_id, idempotency_key);
