-- Owner confirmed 2026-11-05: shipping is paid and fulfilled with GIG Logistics.
-- Correct only the known stale policy; preserve timing and all other trust data.
-- Apply with the separately authorized release, then invalidate merchant caches.
UPDATE public.merchants
SET trust_profile = jsonb_set(
  trust_profile,
  '{shipping_policy}',
  (trust_profile->'shipping_policy') || jsonb_build_object(
    'summary', 'Delivery is handled by GIG Logistics. Shipping is paid, with the delivery fee calculated and confirmed at checkout for your destination. Shipping is not free.',
    'shipping_fee_type', 'calculated'
  )
)
WHERE id = '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid
  AND slug = 'ogabassey'
  AND trust_profile #>> '{shipping_policy,summary}' =
    'Nationwide delivery is available, with free delivery within Lagos where eligible and checkout-confirmed shipping for other Nigerian locations.'
  AND trust_profile #>> '{shipping_policy,shipping_fee_type}' = 'calculated_at_checkout';
