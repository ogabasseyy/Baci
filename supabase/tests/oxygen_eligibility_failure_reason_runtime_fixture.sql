-- Minimal dependencies for exercising the real Oxygen runtime function.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE SCHEMA oxygen_private;
GRANT USAGE ON SCHEMA auth, oxygen_private TO authenticated;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
CREATE TABLE auth.users (
 id uuid PRIMARY KEY, instance_id uuid, aud text, role text, email text,
 encrypted_password text, email_confirmed_at timestamptz, created_at timestamptz,
 updated_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb
);
CREATE TABLE public.merchants (id uuid PRIMARY KEY, user_id uuid, email text, business_name text, slug text);
CREATE TABLE public.customers (id uuid PRIMARY KEY, merchant_id uuid, user_id uuid, first_name text, last_name text, email text);
CREATE TABLE public.orders (
 id uuid PRIMARY KEY, merchant_id uuid, customer_id uuid, order_number text,
 total numeric, currency text, payment_status text, payment_method text,
 customer_phone text, cancelled_at timestamptz, shipping_address jsonb DEFAULT '{}'::jsonb
);
CREATE TABLE public.oxygen_workflows (
 id uuid PRIMARY KEY, order_id uuid, merchant_id uuid, customer_id uuid,
 created_channel text DEFAULT 'web', environment text DEFAULT 'staging',
 stage text DEFAULT 'eligibility_required', version integer DEFAULT 0,
 created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE oxygen_private.commands (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workflow_id uuid, idempotency_key uuid, expected_version integer,
 channel text, command jsonb, status text DEFAULT 'queued', created_at timestamptz DEFAULT now(),
 started_at timestamptz, completed_at timestamptz
);
CREATE FUNCTION oxygen_private.record_command(p_id uuid,p_outcome text,p_stage text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 UPDATE oxygen_private.commands SET status=p_outcome WHERE id=p_id;
 UPDATE public.oxygen_workflows SET stage=p_stage,version=version+1
  WHERE id=(SELECT workflow_id FROM oxygen_private.commands WHERE id=p_id);
END $$;
CREATE FUNCTION oxygen_private.claim_command(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb;
BEGIN
 UPDATE oxygen_private.commands SET status='executing',started_at=now()
 WHERE id=p_id AND status='queued' RETURNING command INTO result;
 RETURN result;
END $$;
CREATE UNIQUE INDEX fixture_one_pending_command ON oxygen_private.commands(workflow_id)
 WHERE status IN ('queued','executing','indeterminate');
