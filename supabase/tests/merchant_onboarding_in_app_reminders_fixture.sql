-- Disposable fixture from merchant_onboarding_email_fixture.sql ONLY.
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON public.merchants TO authenticated;
INSERT INTO auth.users(id) VALUES ('10000000-0000-4000-8000-000000000099');
INSERT INTO public.merchants(id,user_id) VALUES (
  '20000000-0000-4000-8000-000000000099','10000000-0000-4000-8000-000000000099');
