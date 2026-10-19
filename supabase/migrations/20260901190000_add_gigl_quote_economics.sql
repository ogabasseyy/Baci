ALTER TABLE public.shipping_quotes
  ADD COLUMN IF NOT EXISTS provider_cost numeric(12,2),
  ADD COLUMN IF NOT EXISTS platform_margin numeric(12,2),
  ADD COLUMN IF NOT EXISTS platform_margin_bps integer,
  ADD COLUMN IF NOT EXISTS pricing_version text;

ALTER TABLE public.shipping_quotes
  DROP CONSTRAINT IF EXISTS shipping_quotes_provider_cost_nonnegative,
  ADD CONSTRAINT shipping_quotes_provider_cost_nonnegative CHECK (provider_cost IS NULL OR provider_cost >= 0),
  DROP CONSTRAINT IF EXISTS shipping_quotes_platform_margin_nonnegative,
  ADD CONSTRAINT shipping_quotes_platform_margin_nonnegative CHECK (platform_margin IS NULL OR platform_margin >= 0),
  DROP CONSTRAINT IF EXISTS shipping_quotes_platform_margin_bps_valid,
  ADD CONSTRAINT shipping_quotes_platform_margin_bps_valid CHECK (platform_margin_bps IS NULL OR (platform_margin_bps >= 0 AND platform_margin_bps <= 10000));
