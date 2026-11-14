CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA oxygen_private; CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid,instance_id uuid,aud text,role text,email text,encrypted_password text,email_confirmed_at timestamptz,created_at timestamptz,updated_at timestamptz,raw_app_meta_data jsonb,raw_user_meta_data jsonb);
CREATE TABLE public.merchants(id uuid,user_id uuid,email text,business_name text,slug text);
CREATE TABLE public.customers(id uuid,merchant_id uuid,user_id uuid,first_name text,last_name text,email text);
CREATE TABLE public.orders(id uuid,merchant_id uuid,customer_id uuid,order_number text,total numeric,currency text,payment_status text,payment_method text);
CREATE TABLE public.oxygen_workflows(id uuid PRIMARY KEY,order_id uuid,merchant_id uuid,customer_id uuid,stage text,version integer DEFAULT 0,updated_at timestamptz);
CREATE TABLE oxygen_private.provider_states(workflow_id uuid PRIMARY KEY,state jsonb);
CREATE TABLE oxygen_private.partner_workers(partner_reference text,worker_user_id uuid);
CREATE TABLE oxygen_private.runtime_bindings(merchant_id uuid,worker_user_id uuid,partner_reference text,enabled boolean);
CREATE TABLE oxygen_private.commands(id uuid PRIMARY KEY,workflow_id uuid,command jsonb,status text,expected_version integer,started_at timestamptz,completed_at timestamptz,idempotency_key uuid,channel text);
CREATE TABLE oxygen_private.history(id bigint GENERATED ALWAYS AS IDENTITY,workflow_id uuid,command_id uuid,stage text,version integer);
CREATE TABLE oxygen_private.provider_reference_history(command_id uuid,workflow_id uuid,application_reference uuid,booking_reference uuid);
CREATE FUNCTION oxygen_private.runtime(text,uuid,jsonb) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 --   PERFORM oxygen_private.retire_stale_queued_eligibility(w.id,v_key);
END $$;
