CREATE INDEX IF NOT EXISTS merchant_shipping_charges_merchant_id_idx ON public.merchant_shipping_charges (merchant_id);
CREATE INDEX IF NOT EXISTS merchant_shipping_charges_shipping_quote_id_idx ON public.merchant_shipping_charges (shipping_quote_id);
CREATE INDEX IF NOT EXISTS merchant_shipping_charges_debit_transaction_id_idx ON public.merchant_shipping_charges (debit_transaction_id);
CREATE INDEX IF NOT EXISTS merchant_shipping_charges_refund_transaction_id_idx ON public.merchant_shipping_charges (refund_transaction_id);
CREATE INDEX IF NOT EXISTS merchant_shipping_charges_shipment_id_idx ON public.merchant_shipping_charges (shipment_id);
CREATE INDEX IF NOT EXISTS merchant_wallet_payment_accounts_request_id_idx ON public.merchant_wallet_payment_accounts (request_id);
CREATE INDEX IF NOT EXISTS shipping_quote_attestations_order_id_idx ON public.shipping_quote_attestations (order_id);
CREATE INDEX IF NOT EXISTS shipping_quote_attestations_merchant_id_idx ON public.shipping_quote_attestations (merchant_id);
