-- Disposable-suite shims only. Never apply to a deployed database.
--
-- Bridges the drift between storefront_search_refinements_fixture.sql and
-- the live search migration chain: SQL-language function bodies are
-- validated at CREATE time, so every column/table the chain references
-- must exist before the chain loads. Mirrors the real definitions (see
-- 20260418000000_baseline.sql, 20260621130000, merchants.is_platform_admin).
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS specifications jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS variant_model text DEFAULT 'legacy' NOT NULL;
ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS is_platform_admin boolean DEFAULT false;

CREATE TABLE IF NOT EXISTS public.categories(
  id uuid PRIMARY KEY, merchant_id uuid NOT NULL, name text NOT NULL,
  slug text NOT NULL, description text, parent_id uuid, image_url text,
  display_order integer DEFAULT 0, is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  seo_heading text, seo_description text, seo_features jsonb DEFAULT '[]'::jsonb,
  buying_guide_url text, seo_faq jsonb DEFAULT '[]'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb
);
GRANT SELECT ON public.categories TO anon, authenticated;
