-- Owner decision (2026-10-31): staff whose merged permissions grant
-- orders.fulfill may run the admin GIG merchant-wallet flow the owner runs.
-- Staff without orders.fulfill stay blocked; the owner keeps full access
-- because the helper short-circuits for the merchant owner.
--
-- Read and consent steps need orders.fulfill: price preview and bound-quote
-- reuse (one balance number), the wallet funding account view, funding
-- consent and funding recovery. Write steps that commit the order to a
-- booking need orders.fulfill AND orders.edit: quote binding, a NEW wallet
-- debit, and customer-checkout shipping recovery. Booking itself
-- (claim_order_shipment_booking and the final order write) runs under
-- orders_update_policy (owner or orders.edit), so a fulfil-only debit or
-- destination change could never be consumed by a booking. Requiring both
-- keeps the chain consistent; it changes nothing for the owner or for staff
-- roles that hold both grants.
--
-- Every gate calls the SECURITY DEFINER helper public.check_staff_permission
-- with the caller's own auth.uid(). No policy inlines a merchants <->
-- staff_members subquery (42P17 recursion). get_wallet_summary is NOT
-- widened: it also returns earnings, withdrawals, settlements and payout
-- schedule. Copied bodies come verbatim from their newest definitions; only
-- the authorization lines differ.
--
-- The change ships as ordered migrations, one concern each:
--   20261031130000 actor columns (this file)
--   20261031130100 narrow wallet balance and funding-account reads
--   20261031130200 admin GIG quote bind
--   20261031130300 merchant wallet shipping reservation
--   20261031130400 funding-request policies and recovery functions
--   20261031130500 customer-checkout shipping recovery assert/confirm

-- 0. Actor attribution. Staff can now spend wallet money and give funding
--    consent, so record who acted. The columns are added without a default
--    first so existing rows stay NULL; new rows capture the caller's JWT
--    subject, including inside the SECURITY DEFINER reservation, whose INSERT
--    does not list the column. Clients cannot forge either value:
--    authenticated has no write grant on merchant_shipping_charges, and the
--    funding-request insert policy below pins requested_by to the caller.
ALTER TABLE public.merchant_shipping_charges ADD COLUMN reserved_by uuid;
ALTER TABLE public.merchant_shipping_charges
  ALTER COLUMN reserved_by SET DEFAULT auth.uid();
COMMENT ON COLUMN public.merchant_shipping_charges.reserved_by IS
  'auth.users id of the owner or staff member who created the wallet debit; NULL for rows created before 2026-10-31.';
GRANT SELECT (reserved_by) ON TABLE public.merchant_shipping_charges TO authenticated;
ALTER TABLE public.merchant_wallet_funding_account_requests
  ADD COLUMN requested_by uuid;
ALTER TABLE public.merchant_wallet_funding_account_requests
  ALTER COLUMN requested_by SET DEFAULT auth.uid();
COMMENT ON COLUMN public.merchant_wallet_funding_account_requests.requested_by IS
  'auth.users id of the owner or staff member who gave the funding-account consent; NULL for rows created before 2026-10-31.';
