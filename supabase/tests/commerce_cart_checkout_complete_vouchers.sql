-- Real final snapshot classification and pooled availability; disposable data.
CREATE TEMP TABLE voucher_pair_failures(message text);
CREATE FUNCTION pg_temp.check_voucher_pair(ok boolean,message text) RETURNS void LANGUAGE sql AS $$ INSERT INTO voucher_pair_failures SELECT message WHERE NOT coalesce(ok,false) $$;
DO $$
DECLARE m uuid:='11111111-1111-4111-8111-111111111111'; p uuid:='44444444-4444-4444-8444-444444444444';
 c uuid:='aaaaaaaa-4500-4000-8000-000000000001'; snapshot jsonb; line jsonb; n integer;
BEGIN
 INSERT INTO public.commerce_carts(id,merchant_id,expires_at) VALUES(c,m,now()+interval '1 day');
 UPDATE public.products SET manage_stock=true,stock=2,stock_quantity=2,price=15,status='active' WHERE id=p;
 INSERT INTO public.commerce_cart_lines(merchant_id,cart_id,product_id,options,quantity,last_unit_price_minor,voucher_token,voucher_award_id) VALUES
 (m,c,p,'{"lane":"token-only"}',1,1500,'private-token',NULL),
 (m,c,p,'{"lane":"award-only"}',1,1500,NULL,'dddddddd-4500-4000-8000-000000000001'),
 (m,c,p,'{"lane":"complete"}',1,1500,'complete-token','dddddddd-4500-4000-8000-000000000002');
 snapshot:=public.commerce_cart_build_checkout_snapshot(m,c);
 PERFORM pg_temp.check_voucher_pair((snapshot->'estimates'->>'subtotalMinor')::bigint=3000,'partial vouchers were free in checkout subtotal');
 FOR line IN SELECT value FROM jsonb_array_elements(snapshot->'lines') LOOP
  IF line->'options'->>'lane'='complete' THEN
   PERFORM pg_temp.check_voucher_pair((line->>'effectiveUnitPriceMinor')::bigint=0 AND (line->>'available')::boolean,'complete voucher lost free or reserved availability semantics');
  ELSE
   PERFORM pg_temp.check_voucher_pair((line->>'effectiveUnitPriceMinor')::bigint=1500 AND (line->>'available')::boolean,'partial voucher was not ordinary priced/in-stock');
  END IF;
 END LOOP;
 -- Pool demand must include BOTH partial pairs. Neither one individually
 -- exceeds stock, but together they require 2 units and must fail at stock1.
 UPDATE public.products SET stock=1,stock_quantity=1 WHERE id=p;
 snapshot:=public.commerce_cart_build_checkout_snapshot(m,c);
 FOR line IN SELECT value FROM jsonb_array_elements(snapshot->'lines') LOOP
  IF line->'options'->>'lane'='complete' THEN
   PERFORM pg_temp.check_voucher_pair((line->>'available')::boolean,'complete reserved voucher consumed public stock');
  ELSE
   PERFORM pg_temp.check_voucher_pair(line->>'available'='false' AND line->>'unavailableReason'='insufficient_stock','partial voucher escaped pooled stock demand');
  END IF;
 END LOOP;
 UPDATE public.products SET stock=0,stock_quantity=0 WHERE id=p;
 snapshot:=public.commerce_cart_build_checkout_snapshot(m,c);
 FOR line IN SELECT value FROM jsonb_array_elements(snapshot->'lines') LOOP
  IF line->'options'->>'lane'='complete' THEN
   PERFORM pg_temp.check_voucher_pair((line->>'available')::boolean,'complete reserved voucher unavailable with no public stock');
  ELSE
   PERFORM pg_temp.check_voucher_pair(line->>'available'='false' AND line->>'unavailableReason'='out_of_stock','partial voucher bypassed out-of-stock guard');
  END IF;
 END LOOP;
END $$;
DO $$ DECLARE failures text; BEGIN SELECT string_agg(message,E'\n') INTO failures FROM voucher_pair_failures; IF failures IS NOT NULL THEN RAISE EXCEPTION E'Checkout voucher pair regressions:\n%',failures; END IF; END $$;
