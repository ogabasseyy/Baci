-- Idempotency keys for loyalty reward redemption (issue #3165).
--
-- A lost-response retry mints a second redemption (new code, second
-- deduction). The redeem route requires a client Idempotency-Key (UUID,
-- mirroring the VTU wallet-only route); this table maps each key to the
-- stored success response so retries replay instead of re-spending.
-- Failures are never stored: a failed attempt (e.g. insufficient
-- points) retries as a fresh attempt under the same key after a top-up.
--
-- Concurrency: redeem_loyalty_reward takes an advisory lock on the key
-- before the lookup, so concurrent same-key retries serialize and the
-- loser replays the winner's stored response (no orphan redemptions).
-- Scope: the (merchant, customer, reward) columns are the ownership +
-- intent check — a key replayed with different params is rejected
-- (400 cross-tenant, 409 changed reward), never replayed.
--
-- RLS is enabled with no policies (mirroring vtu_idempotency_keys):
-- only the DEFINER redeem RPC touches this table. service_role holds
-- grants for admin/cleanup parity.
CREATE TABLE IF NOT EXISTS public.loyalty_redemption_idempotency_keys (
  key uuid PRIMARY KEY,
  merchant_id uuid NOT NULL
    REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL
    REFERENCES public.customers(id) ON DELETE CASCADE,
  -- SET NULL, not CASCADE: the receipt must survive its mutable reward
  -- row (mirroring reward_redemptions), so a lost-response retry after
  -- a reward delete still replays instead of re-spending or failing.
  reward_id uuid
    REFERENCES public.loyalty_rewards(id) ON DELETE SET NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX IF NOT EXISTS loyalty_redemption_idempotency_keys_customer_idx
  ON public.loyalty_redemption_idempotency_keys(customer_id, merchant_id);
CREATE INDEX IF NOT EXISTS loyalty_redemption_idempotency_keys_merchant_idx
  ON public.loyalty_redemption_idempotency_keys(merchant_id);
CREATE INDEX IF NOT EXISTS loyalty_redemption_idempotency_keys_reward_idx
  ON public.loyalty_redemption_idempotency_keys(reward_id);

ALTER TABLE public.loyalty_redemption_idempotency_keys ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.loyalty_redemption_idempotency_keys FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.loyalty_redemption_idempotency_keys TO service_role;

-- Lookup helper (kept out of the redeem RPC: that file sits near the
-- repository's 300-line limit). Returns NULL on a miss; the stored
-- success response on a hit; or a failure envelope when the key is
-- replayed with different params. The caller returns any non-NULL
-- result verbatim.
CREATE OR REPLACE FUNCTION public.get_loyalty_redemption_idempotency(
  p_key uuid,
  p_merchant_id uuid,
  p_customer_id uuid,
  p_reward_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row record;
BEGIN
  SELECT merchant_id, customer_id, reward_id, response
  INTO v_row
  FROM public.loyalty_redemption_idempotency_keys
  WHERE key = p_key;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  -- Ownership first (stolen-key replay), then intent (changed reward):
  -- same split as the VTU wallet-only route (400 vs 409).
  IF v_row.merchant_id IS DISTINCT FROM p_merchant_id
     OR v_row.customer_id IS DISTINCT FROM p_customer_id THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'idempotency_key_mismatch'
    );
  END IF;
  -- A NULL stored reward means the reward row was deleted after the
  -- success was recorded (SET NULL above): the receipt is still this
  -- key's immutable proof, so replay it rather than 409ing.
  IF v_row.reward_id IS NOT NULL
     AND v_row.reward_id IS DISTINCT FROM p_reward_id THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'idempotency_key_reused'
    );
  END IF;
  RETURN v_row.response;
END;
$$;

REVOKE ALL ON FUNCTION public.get_loyalty_redemption_idempotency(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_loyalty_redemption_idempotency(uuid, uuid, uuid, uuid)
  TO service_role;

-- Store helper: records the success response under the key. The caller
-- holds the key advisory lock, so the insert cannot conflict; ON
-- CONFLICT keeps the winner on any path that bypasses the lock.
CREATE OR REPLACE FUNCTION public.store_loyalty_redemption_idempotency(
  p_key uuid,
  p_merchant_id uuid,
  p_customer_id uuid,
  p_reward_id uuid,
  p_response jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.loyalty_redemption_idempotency_keys (
    key, merchant_id, customer_id, reward_id, response
  ) VALUES (
    p_key, p_merchant_id, p_customer_id, p_reward_id, p_response
  )
  ON CONFLICT (key) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.store_loyalty_redemption_idempotency(uuid, uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_loyalty_redemption_idempotency(uuid, uuid, uuid, uuid, jsonb)
  TO service_role;
