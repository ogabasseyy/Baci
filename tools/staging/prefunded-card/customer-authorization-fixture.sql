CREATE ROLE prefunded_card_authorization_reader;
CREATE ROLE prefunded_card_authorization_provisioner;
GRANT prefunded_card_authorization_reader TO projection_worker;
ALTER TABLE public.merchants ADD COLUMN slug text DEFAULT 'synthetic';
ALTER TABLE public.customer_saved_payment_methods
  ADD COLUMN authorization_code text DEFAULT 'AUTH_fixture',
  ADD COLUMN authorization_signature text DEFAULT 'SIG_fixture',
  ADD COLUMN authorization_data jsonb DEFAULT '{"authorization_code":"AUTH_fixture","signature":"SIG_fixture","channel":"card","reusable":true}',
  ADD COLUMN provider_customer_email text DEFAULT 'fixture@example.test',
  ADD COLUMN brand text DEFAULT 'visa',
  ADD COLUMN last4 text DEFAULT '4081';
CREATE TABLE public.transactions(id uuid PRIMARY KEY,merchant_id uuid,gateway text,transaction_type text,
  status text,currency text,metadata jsonb,gateway_reference text,amount numeric);
