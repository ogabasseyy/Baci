-- Incomplete canonical voucher attachments are ordinary priced lines. Never
-- promote one raw award reference into an order voucher or require its echo.
DO $repair$
DECLARE definition text; old text;
BEGIN
 definition:=pg_get_functiondef('public.create_storefront_order_with_cart_binding(text,uuid,integer,jsonb)'::regprocedure);
 IF position('-- Complete-pair order award.' IN definition)>0 THEN RETURN; END IF;
 old:=$old$          'voucher_award_id', s.sl -> 'voucherAwardId',$old$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'derived voucher pair source mismatch'; END IF;
 definition:=replace(definition,old,$new$          -- Complete-pair order award.
          'voucher_award_id', CASE WHEN s.sl->>'voucherToken' IS NOT NULL AND s.sl->>'voucherAwardId' IS NOT NULL
            THEN s.sl->'voucherAwardId' ELSE 'null'::jsonb END,$new$);
 old:=$old$            AND nullif(item ->> 'voucher_award_id', '') IS NOT DISTINCT FROM l.voucher_award_id::text$old$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'binding voucher pair source mismatch'; END IF;
 definition:=replace(definition,old,$new$            AND nullif(item ->> 'voucher_award_id', '') IS NOT DISTINCT FROM
              CASE WHEN l.voucher_token IS NOT NULL AND l.voucher_award_id IS NOT NULL
                THEN l.voucher_award_id::text ELSE NULL END$new$);
 EXECUTE definition;
END $repair$;
