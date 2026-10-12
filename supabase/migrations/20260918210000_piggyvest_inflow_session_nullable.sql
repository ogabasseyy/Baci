-- Additive relaxation for genuine provider payloads (18 Sep 2026).
--
-- The genuine bank-transfer.inflow.success event observed on staging
-- omits session_id (no equivalent reference exists on that shape), so
-- the NOT NULL constraint would reject the ledger write. References that
-- identify the movement (transaction/reference/internal) remain required.

ALTER TABLE public.piggyvest_inflow_credits
  ALTER COLUMN session_id DROP NOT NULL;
