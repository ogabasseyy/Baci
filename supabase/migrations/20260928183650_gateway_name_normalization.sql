-- Shared gateway-name normalization for the Paystack reconciliation
-- RPCs and candidate indexes. Legacy rows may pad or re-case gateway
-- values (` Paystack `) while cancellation still treats them as live
-- captures, so every comparison trims whitespace and uppercases, and
-- missing or blank gateways normalize to NULL and never match a real
-- gateway. Immutable so candidate-selection partial indexes can key
-- on it; called by record_verified_paystack_cancellation_refund_v1,
-- the abandoned-sweep write RPCs, and the candidate-selection RPCs.

CREATE OR REPLACE FUNCTION public.normalized_gateway_name_v1(
  p_gateway text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT NULLIF(
    upper(
      regexp_replace(
        COALESCE(p_gateway, ''),
        '^\s+|\s+$',
        '',
        'g'
      )
    ),
    ''
  );
$$;
