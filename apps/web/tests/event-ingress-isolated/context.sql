-- Extend the dedicated event-fixture bootstrap with only the fields the real
-- context resolver reads. Public visibility follows the production predicates.
BEGIN;
ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS slug text UNIQUE;
ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS is_published boolean NOT NULL DEFAULT false;
UPDATE public.merchants
SET slug = 'route-alpha', is_published = true
WHERE id = '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a331';
UPDATE public.merchants
SET slug = 'route-beta', is_published = true
WHERE id = '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a339';
DROP POLICY IF EXISTS "Anon can view merchants" ON public.merchants;
CREATE POLICY "Anon can view merchants" ON public.merchants
FOR SELECT TO anon USING (is_published IS TRUE);

CREATE TABLE IF NOT EXISTS public.merchant_slug_aliases (
  old_slug text PRIMARY KEY,
  merchant_id uuid NOT NULL REFERENCES public.merchants (id)
);
ALTER TABLE public.merchant_slug_aliases ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.merchant_slug_aliases TO anon;
DROP POLICY IF EXISTS "slug aliases are publicly readable" ON public.merchant_slug_aliases;
CREATE POLICY "slug aliases are publicly readable" ON public.merchant_slug_aliases
FOR SELECT TO anon USING (true);
INSERT INTO public.merchant_slug_aliases VALUES
  ('route-old-alpha', '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a331')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.domains (
  domain text PRIMARY KEY,
  merchant_id uuid NOT NULL REFERENCES public.merchants (id),
  status text NOT NULL,
  verified_at timestamptz
);
ALTER TABLE public.domains ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.domains TO anon;
DROP POLICY IF EXISTS domains_select_policy ON public.domains;
CREATE POLICY domains_select_policy ON public.domains
FOR SELECT USING (
  (status = 'active' AND verified_at IS NOT NULL)
  OR merchant_id IN (SELECT id FROM public.merchants WHERE user_id = (SELECT auth.uid()))
);
INSERT INTO public.domains VALUES
  ('route-shop.invalid', '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a331', 'active', now()),
  ('route-unverified.invalid', '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a331', 'active', NULL)
ON CONFLICT DO NOTHING;
NOTIFY pgrst, 'reload schema';
COMMIT;
