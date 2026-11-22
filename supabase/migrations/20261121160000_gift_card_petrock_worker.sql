DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gift_card_petrock_worker') THEN
    CREATE ROLE gift_card_petrock_worker NOLOGIN;
  END IF;
END
$$;

ALTER TABLE public.gift_card_wallet_orders
  ADD COLUMN attempt_started_at timestamptz,
  ADD COLUMN provider_terminal_status text CHECK (provider_terminal_status IN ('success', 'reject')),
  ADD COLUMN sealed_provider_replay text CHECK (octet_length(sealed_provider_replay) < 90000),
  ADD COLUMN provider_captured_at timestamptz;

CREATE FUNCTION public.read_gift_card_worker_order(p_id uuid)
RETURNS TABLE(id uuid, product_id text, amount_kobo bigint, status text, provider_order_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT o.id, o.product_id, o.amount_kobo, o.status, o.provider_order_id
  FROM public.gift_card_wallet_orders o
  WHERE o.id = p_id
$$;

CREATE FUNCTION public.claim_gift_card_petrock_attempt(p_id uuid, p_product_id text, p_amount_kobo bigint)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $$
  WITH attempt AS (
    UPDATE public.gift_card_wallet_orders o
       SET status = 'submitting', attempt_started_at = clock_timestamp()
     WHERE o.id = p_id AND o.product_id = p_product_id
       AND o.amount_kobo = p_amount_kobo AND o.status = 'paid'
       AND o.attempt_started_at IS NULL
    RETURNING o.id
  )
  SELECT EXISTS (SELECT 1 FROM attempt)
$$;

CREATE FUNCTION public.record_gift_card_petrock_submission(p_id uuid, p_provider_id text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $$
  WITH recorded AS (
    UPDATE public.gift_card_wallet_orders o
       SET status = CASE WHEN p_provider_id IS NULL THEN 'submission_unknown' ELSE 'submitted' END,
           provider_order_id = p_provider_id
     WHERE o.id = p_id AND o.status = 'submitting'
       AND (p_provider_id IS NULL OR p_provider_id ~ '^[A-Za-z0-9_-]{1,128}$')
    RETURNING o.id
  )
  SELECT EXISTS (SELECT 1 FROM recorded)
$$;

CREATE FUNCTION public.capture_gift_card_petrock_result(
  p_id uuid, p_provider_id text, p_terminal_status text, p_sealed_replay text
)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $$
  WITH captured AS (
    UPDATE public.gift_card_wallet_orders o
       SET provider_terminal_status = p_terminal_status,
           sealed_provider_replay = p_sealed_replay,
           provider_captured_at = clock_timestamp()
     WHERE o.id = p_id AND o.status = 'submitted'
       AND o.provider_order_id = p_provider_id AND o.provider_captured_at IS NULL
       AND p_terminal_status IN ('success', 'reject')
       AND p_sealed_replay ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$'
    RETURNING o.id
  )
  SELECT EXISTS (SELECT 1 FROM captured)
$$;

REVOKE ALL ON FUNCTION public.read_gift_card_worker_order(uuid),
  public.claim_gift_card_petrock_attempt(uuid, text, bigint),
  public.record_gift_card_petrock_submission(uuid, text),
  public.capture_gift_card_petrock_result(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.read_gift_card_worker_order(uuid),
  public.claim_gift_card_petrock_attempt(uuid, text, bigint),
  public.record_gift_card_petrock_submission(uuid, text),
  public.capture_gift_card_petrock_result(uuid, text, text, text)
  TO gift_card_petrock_worker;
