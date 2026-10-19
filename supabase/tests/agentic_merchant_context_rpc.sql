-- Behavioral regression for the agentic merchant-context boundary:
-- the UCP cart routes resolve the configured merchant through this
-- scoped SECURITY DEFINER projection instead of a service-role client.
ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS business_name text,
  ADD COLUMN IF NOT EXISTS paystack_subaccount_code text;
CREATE TABLE IF NOT EXISTS public.domains (
  id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL,
  domain text,
  is_primary boolean NOT NULL DEFAULT false,
  status text,
  updated_at timestamptz,
  created_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.merchant_feature_settings (
  merchant_id uuid PRIMARY KEY,
  agentic_checkout_enabled boolean,
  pay_on_delivery_enabled boolean,
  custom_settings jsonb
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
END
$$;

INSERT INTO public.merchants (id, slug, business_name, paystack_subaccount_code)
VALUES (
  '77777777-7777-4777-8777-777777777777',
  'agentic-context-fixture',
  'Fixture Store',
  'ACCT_fixture'
)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.domains (id, merchant_id, domain, is_primary, status)
VALUES (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '77777777-7777-4777-8777-777777777777',
  'fixture.example.com',
  true,
  'active'
)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.merchant_feature_settings (
  merchant_id, agentic_checkout_enabled, pay_on_delivery_enabled, custom_settings
)
VALUES (
  '77777777-7777-4777-8777-777777777777',
  true,
  true,
  '{"agentic_agent_allowlist": ["fixture-agent"]}'::jsonb
)
ON CONFLICT (merchant_id) DO NOTHING;

-- The RPC is executable only by the server-minted, slug-bound
-- agentic_merchant_context role (20261015179995); anon must be denied.
SET ROLE anon;
DO $$
BEGIN
  IF has_function_privilege(
    'anon', 'public.resolve_agentic_merchant_context(text)', 'execute'
  ) THEN
    RAISE EXCEPTION 'merchant context RPC must not be executable by anon';
  END IF;
END
$$;
RESET ROLE;
SET ROLE agentic_merchant_context;
SELECT set_config(
  'request.jwt.claims',
  '{"role":"agentic_merchant_context","agentic_merchant_slug":"agentic-context-fixture"}',
  true
);
DO $$
DECLARE v_row record;
BEGIN
  SELECT * INTO v_row
  FROM public.resolve_agentic_merchant_context('  AGENTIC-CONTEXT-FIXTURE ');
  IF v_row.id <> '77777777-7777-4777-8777-777777777777'
    OR v_row.slug <> 'agentic-context-fixture'
    OR v_row.business_name <> 'Fixture Store'
    OR v_row.paystack_subaccount_code IS NOT NULL
    OR v_row.custom_domain <> 'fixture.example.com'
    OR v_row.agentic_checkout_enabled IS DISTINCT FROM true
    OR v_row.pay_on_delivery_enabled IS DISTINCT FROM true
    OR v_row.agent_allowlist <> '["fixture-agent"]'::jsonb
    OR v_row.agent_denylist IS NOT NULL
  THEN
    RAISE EXCEPTION 'agentic merchant context projection mismatch: %', v_row;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.resolve_agentic_merchant_context('no-such-merchant')
  ) THEN
    RAISE EXCEPTION 'unknown slug must resolve no merchant context';
  END IF;
  IF has_function_privilege(
    'public', 'public.resolve_agentic_merchant_context(text)', 'execute'
  ) THEN
    RAISE EXCEPTION 'merchant context RPC must not be executable by PUBLIC';
  END IF;
END
$$;
RESET ROLE;
