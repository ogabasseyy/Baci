-- A partial voucher attachment is an ordinary priced, stock-consuming line.
-- Match the order payload's complete-pair classification in every snapshot use.
DO $repair$
DECLARE definition text; old text;
BEGIN
 definition:=pg_get_functiondef('public.commerce_cart_build_checkout_snapshot(uuid,uuid)'::regprocedure);
 old:='voucher_token IS NOT NULL OR voucher_award_id IS NOT NULL';
 IF position(old IN definition)=0 AND (length(definition)-length(replace(definition,'voucher_token IS NOT NULL AND voucher_award_id IS NOT NULL','')))/length('voucher_token IS NOT NULL AND voucher_award_id IS NOT NULL')=2 THEN RETURN; END IF;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>2 THEN RAISE EXCEPTION 'checkout voucher classification source mismatch'; END IF;
 definition:=replace(definition,old,'voucher_token IS NOT NULL AND voucher_award_id IS NOT NULL');
 EXECUTE definition;
END $repair$;
