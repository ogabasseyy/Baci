-- Remove legacy Paystack DVA overloads that accepted caller-controlled
-- payable amounts. The server-derived and proof-bound signatures are the only
-- supported reservation contracts.

DROP FUNCTION IF EXISTS public.refresh_paystack_order_payable_amount(
  uuid, numeric
);

DROP FUNCTION IF EXISTS public.reserve_paystack_order_payment_account(
  uuid, text, text, text, numeric, timestamptz, timestamptz
);
