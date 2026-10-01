-- REGRESSION: Nigerian local trunk phones (0XXXXXXXXXX) must normalize and
-- pass the usable-phone gate used by get_repair_pickup_receiver.

BEGIN;

DO $test$
BEGIN
  IF public.normalize_repair_pickup_phone_digits('09070007000')
    IS DISTINCT FROM '2349070007000'
  THEN
    RAISE EXCEPTION 'local Nigerian trunk phone did not normalize to 234…';
  END IF;

  IF public.is_usable_repair_pickup_phone('09070007000') IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'local Nigerian trunk phone was rejected as unusable';
  END IF;

  IF public.normalize_repair_pickup_phone_digits('+234 907 000 7000')
    IS DISTINCT FROM '2349070007000'
  THEN
    RAISE EXCEPTION 'international Nigerian phone did not normalize';
  END IF;

  IF public.is_usable_repair_pickup_phone('') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'empty phone was accepted';
  END IF;
END;
$test$;

ROLLBACK;
