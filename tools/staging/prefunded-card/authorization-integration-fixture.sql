CREATE TABLE IF NOT EXISTS public.transactions(
  id uuid PRIMARY KEY,merchant_id uuid NOT NULL,transaction_type text NOT NULL,
  amount numeric(15,2) NOT NULL,currency text NOT NULL,status text NOT NULL,
  gateway text,gateway_reference text,gateway_response jsonb,metadata jsonb
);
ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE public.customer_saved_payment_methods
  ADD COLUMN IF NOT EXISTS provider_customer_email text,
  ADD COLUMN IF NOT EXISTS authorization_code text,
  ADD COLUMN IF NOT EXISTS authorization_signature text,
  ADD COLUMN IF NOT EXISTS authorization_data jsonb;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='prefunded_card_authorization_reader') THEN
    CREATE ROLE prefunded_card_authorization_reader NOLOGIN;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='prefunded_card_authorization_provisioner') THEN
    CREATE ROLE prefunded_card_authorization_provisioner NOLOGIN;
  END IF;
END $$;
CREATE SCHEMA authorization_fixture;
CREATE FUNCTION authorization_fixture.seed(p_treasury uuid,p_method uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE treasury prefunded_card.treasury_bindings%ROWTYPE; method public.customer_saved_payment_methods%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND rolsuper) THEN
    RAISE EXCEPTION 'synthetic fixture admin required';
  END IF;
  SELECT * INTO STRICT treasury FROM prefunded_card.treasury_bindings WHERE id=p_treasury;
  SELECT * INTO STRICT method FROM public.customer_saved_payment_methods WHERE id=p_method AND merchant_id=treasury.merchant_id;
  UPDATE public.customer_saved_payment_methods SET provider_customer_email='original@example.test',
    authorization_code='AUTH_synthetic',authorization_signature='SIG_synthetic',
    authorization_data='{"authorization_code":"AUTH_synthetic","signature":"SIG_synthetic","reusable":true,"channel":"card"}'::jsonb
    WHERE id=method.id;
  INSERT INTO prefunded_card.authorization_bindings(treasury_binding_id,saved_method_id,integration_id,merchant_id,
    customer_id,transaction_id,provider_transaction_id,provider_reference,email,authorization_code,authorization_signature,
    paystack_customer_code,domain,reusable,authorized_login,system_identifier,database_name,provisioned_by)
    VALUES(treasury.id,method.id,treasury.integration_id,method.merchant_id,method.customer_id,gen_random_uuid(),
      '123456789','SAV-AUTH-FIXTURE','original@example.test','AUTH_synthetic','SIG_synthetic','CUS_synthetic',
      'test',true,treasury.authorized_login,(SELECT system_identifier::text FROM pg_control_system()),current_database(),current_user);
  EXECUTE format('GRANT prefunded_card_authorization_reader TO %I',treasury.authorized_login);
  GRANT USAGE ON SCHEMA prefunded_card TO prefunded_card_authorization_reader;
  GRANT EXECUTE ON FUNCTION prefunded_card.read_authorization(uuid,uuid,uuid,uuid,uuid,text)
    TO prefunded_card_authorization_reader;
END $$;
REVOKE ALL ON SCHEMA authorization_fixture FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION authorization_fixture.seed(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
