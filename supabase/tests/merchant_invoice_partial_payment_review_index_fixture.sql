CREATE SCHEMA auth;

CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;

CREATE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT 'service_role'::text;
$$;

CREATE TABLE public.reconciliation_review (
  issue_type text NOT NULL,
  order_id uuid,
  resolved_at timestamptz
);
