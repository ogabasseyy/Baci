CREATE ROLE reversal_worker LOGIN;
CREATE ROLE other_worker LOGIN;
CREATE ROLE prefunded_treasury_ledger_worker;
CREATE ROLE prefunded_treasury_provisioner;
CREATE ROLE prefunded_treasury_verifier;
CREATE ROLE treasury_owner LOGIN;
CREATE ROLE treasury_verifier LOGIN;
GRANT prefunded_treasury_ledger_worker TO reversal_worker;
GRANT prefunded_treasury_provisioner TO treasury_owner;
GRANT prefunded_treasury_verifier TO treasury_verifier;
ALTER TABLE piggyvest_staging.integrations ADD COLUMN expected_provider_account_id text DEFAULT 'business';
ALTER TABLE public.customer_savings_goals ADD COLUMN cancelled_at timestamptz, ADD COLUMN spent_at timestamptz;
CREATE TABLE public.customer_saved_payment_methods (
  id uuid PRIMARY KEY,merchant_id uuid,customer_id uuid,provider text,
  reusable boolean,is_active boolean,disabled_at timestamptz
);
INSERT INTO public.customer_saved_payment_methods VALUES (
  '60000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222','paystack',true,true,NULL
);
