-- CSPRNG loyalty code minting (migration 20261010000027): the four
-- minting functions now source referral and redemption codes from
-- extensions.gen_random_bytes instead of MD5(random() || timestamp),
-- keeping the same code shapes the checkout resolver accepts.
SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_proc AS p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (
        'enroll_customer_loyalty',
        'award_purchase_points',
        'adjust_loyalty_points',
        'redeem_loyalty_reward'
      )
      AND p.prosrc LIKE '%gen_random_bytes%'
      AND p.prosrc NOT LIKE '%md5%'
  ) = 4,
  'csprng mint clause failed'
);

-- Codes minted by the earlier suites keep their shapes: RDM- plus 12
-- uppercase hex for redemptions, 8 uppercase hex for referrals.
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1 FROM public.reward_redemptions
    WHERE discount_code !~ '^RDM-[0-9A-F]{12}$'
  ),
  'redemption code shape clause failed'
);
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1 FROM public.customer_loyalty
    WHERE referral_code IS NOT NULL
      AND referral_code !~ '^[0-9A-F]{8}$'
  ),
  'referral code shape clause failed'
);
