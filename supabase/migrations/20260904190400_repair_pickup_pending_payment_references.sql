-- Preserve every outstanding pending Paystack RPU reference across retries.
-- The repairs.pickup_payment_pending_reference column remains the latest tip;
-- historical refs live in repair_pickup_pending_payment_references so older
-- payable links still resolve after secret rotation / retry overwrite.

CREATE TABLE IF NOT EXISTS public.repair_pickup_pending_payment_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_id uuid NOT NULL,
  merchant_id uuid NOT NULL,
  reference text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  CONSTRAINT repair_pickup_pending_payment_references_reference_format
    CHECK (reference ~ '^RPU-[A-Z0-9]{16}$'),
  CONSTRAINT repair_pickup_pending_payment_references_reference_unique
    UNIQUE (reference),
  CONSTRAINT repair_pickup_pending_payment_references_repair_fk
    FOREIGN KEY (repair_id, merchant_id)
    REFERENCES public.repairs (id, merchant_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS
  repair_pickup_pending_payment_references_repair_id_idx
  ON public.repair_pickup_pending_payment_references (repair_id);

CREATE INDEX IF NOT EXISTS
  repair_pickup_pending_payment_references_merchant_id_idx
  ON public.repair_pickup_pending_payment_references (merchant_id);

COMMENT ON TABLE public.repair_pickup_pending_payment_references IS
  'Every pending Paystack RPU reference bound to an unpaid repair pickup; survives tip-column overwrite on retry.';

ALTER TABLE public.repair_pickup_pending_payment_references
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.repair_pickup_pending_payment_references
  FROM PUBLIC, anon, authenticated, repair_pickup_receiver;
GRANT SELECT, INSERT, UPDATE ON TABLE public.repair_pickup_pending_payment_references
  TO service_role;

INSERT INTO public.repair_pickup_pending_payment_references (
  repair_id,
  merchant_id,
  reference
)
SELECT
  repair.id,
  repair.merchant_id,
  repair.pickup_payment_pending_reference
FROM public.repairs AS repair
WHERE repair.pickup_payment_pending_reference IS NOT NULL
ON CONFLICT (reference) DO NOTHING;

CREATE OR REPLACE FUNCTION public.bind_repair_pickup_pending_payment_reference(
  p_repair_id uuid,
  p_merchant_id uuid,
  p_reference text
)
RETURNS TABLE (bound boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_repair_id IS NULL OR p_merchant_id IS NULL THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  IF p_reference IS NULL OR p_reference !~ '^RPU-[A-Z0-9]{16}$' THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  IF COALESCE(auth.jwt() ->> 'repair_pickup_receiver_context', '')
      IS DISTINCT FROM 'server-quote'
    OR COALESCE(
      auth.jwt() ->> 'repair_pickup_receiver_merchant_id',
      ''
    ) IS DISTINCT FROM p_merchant_id::text
  THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  UPDATE public.repairs AS repair
  SET pickup_payment_pending_reference = p_reference
  WHERE repair.id = p_repair_id
    AND repair.merchant_id = p_merchant_id
    AND repair.service_type = 'pickup'
    AND repair.pickup_payment_reference IS NULL
    AND repair.shipment_id IS NULL
    AND repair.pickup_payment_status = 'awaiting_payment';

  IF NOT FOUND THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  INSERT INTO public.repair_pickup_pending_payment_references (
    repair_id,
    merchant_id,
    reference
  )
  VALUES (p_repair_id, p_merchant_id, p_reference)
  ON CONFLICT (reference) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1
    FROM public.repair_pickup_pending_payment_references AS pending
    WHERE pending.reference = p_reference
      AND pending.repair_id = p_repair_id
      AND pending.merchant_id = p_merchant_id
  ) THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  RETURN QUERY SELECT true;
END;
$$;

COMMENT ON FUNCTION public.bind_repair_pickup_pending_payment_reference(
  uuid, uuid, text
) IS
  'Server-capability-only bind of a pending Paystack RPU reference; appends history and updates the tip column.';

REVOKE ALL ON FUNCTION public.bind_repair_pickup_pending_payment_reference(
  uuid, uuid, text
) FROM PUBLIC, anon, authenticated, service_role, repair_pickup_receiver;
GRANT EXECUTE ON FUNCTION public.bind_repair_pickup_pending_payment_reference(
  uuid, uuid, text
) TO repair_pickup_receiver;

NOTIFY pgrst, 'reload schema';
