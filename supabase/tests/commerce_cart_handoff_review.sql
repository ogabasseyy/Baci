-- Full-chain handoff regression fixture; disposable database only.
-- Loaded by the same minimal catalog/auth fixture as remaining_review.sql.
CREATE TEMP TABLE handoff_review_failures(message text);
CREATE FUNCTION pg_temp.check_handoff(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF NOT coalesce(ok,false) THEN INSERT INTO handoff_review_failures VALUES(message); END IF; END $$;
UPDATE public.merchants SET premium_features='["shared_cart","shared_cart_accounts","shared_cart_realtime"]' WHERE id='11111111-1111-4111-8111-111111111111';
UPDATE public.products SET price=40000000,status='active',stock=10,stock_quantity=10 WHERE id='44444444-4444-4444-8444-444444444444';
INSERT INTO public.commerce_carts(id,merchant_id,expires_at) VALUES
 ('aaaaaaaa-1000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',now()+interval '2 minutes'),
 ('aaaaaaaa-1000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',now()+interval '2 minutes'),
 ('aaaaaaaa-1000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111',now()-interval '1 minute');
INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,expires_at) VALUES
 ('bbbbbbbb-1000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','aaaaaaaa-1000-4000-8000-000000000001','review-origin',now()+interval '2 minutes'),
 ('bbbbbbbb-1000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','aaaaaaaa-1000-4000-8000-000000000002','review-receiver',now()+interval '2 minutes');
INSERT INTO public.commerce_cart_lines(merchant_id,cart_id,product_id,quantity,negotiated_unit_price_minor,negotiation_status,has_assurance,assurance_rate,last_unit_price_minor) VALUES
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-1000-4000-8000-000000000001','44444444-4444-4444-8444-444444444444',1,3000000000,'accepted',true,0.02,4000000000),
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-1000-4000-8000-000000000002','44444444-4444-4444-8444-444444444444',2,3000000000,'accepted',true,0.02,4000000000);
INSERT INTO public.commerce_cart_lines(merchant_id,cart_id,product_id,options,quantity,voucher_token,voucher_award_id,last_unit_price_minor)
VALUES('11111111-1111-4111-8111-111111111111','aaaaaaaa-1000-4000-8000-000000000001','44444444-4444-4444-8444-444444444444','{"prize":"yes"}',1,'private-voucher','dddddddd-1000-4000-8000-000000000001',4000000000);
UPDATE public.commerce_cart_lines SET has_assurance=false,assurance_rate=NULL WHERE cart_id='aaaaaaaa-1000-4000-8000-000000000001';
INSERT INTO public.commerce_cart_handoffs(id,handoff_hash,merchant_id,source_cart_id,expires_at,destination) VALUES
 ('cccccccc-1000-4000-8000-000000000001','review-merge','11111111-1111-4111-8111-111111111111','aaaaaaaa-1000-4000-8000-000000000001',now()+interval '5 minutes','{"type":"native"}'),
 ('cccccccc-1000-4000-8000-000000000002','review-keep','11111111-1111-4111-8111-111111111111','aaaaaaaa-1000-4000-8000-000000000001',now()+interval '5 minutes','{"type":"native"}'),
 ('cccccccc-1000-4000-8000-000000000003','review-expired','11111111-1111-4111-8111-111111111111','aaaaaaaa-1000-4000-8000-000000000003',now()+interval '5 minutes','{"type":"native"}');
SET request.jwt.claims='{"role":"commerce_cart_shopper","exp":9999999999,"cart_scope":"session","cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"review-receiver","cart_id":"aaaaaaaa-1000-4000-8000-000000000002","cart_grant_id":"bbbbbbbb-1000-4000-8000-000000000002"}';
DO $$ DECLARE r jsonb; replay jsonb; BEGIN
 BEGIN
  r:=public.commerce_cart_redeem_handoff('review-merge','cccccccc-1000-4000-8000-000000000001','review-attempt','merge','native','aaaaaaaa-1000-4000-8000-000000000002',1,1,'[{"item":{"productId":"44444444-4444-4444-8444-444444444444"},"quantity":2},{"item":{"productId":"44444444-4444-4444-8444-444444444444","options":{"prize":"yes"}},"quantity":1}]','[]');
  PERFORM pg_temp.check_handoff(r->>'ok'='true','canonical merge rejected');
  PERFORM pg_temp.check_handoff(r->'state'->>'cartId'='aaaaaaaa-1000-4000-8000-000000000001','merge did not retain canonical source');
  PERFORM pg_temp.check_handoff((SELECT count(*)=1 AND max(quantity)=2 AND max(negotiated_unit_price_minor)=3000000000 AND bool_and(has_assurance) FROM public.commerce_cart_lines WHERE cart_id='aaaaaaaa-1000-4000-8000-000000000001' AND options='{}'::jsonb),'private negotiation or assurance lost');
  PERFORM pg_temp.check_handoff((SELECT voucher_token='private-voucher' AND voucher_award_id='dddddddd-1000-4000-8000-000000000001' FROM public.commerce_cart_lines WHERE cart_id='aaaaaaaa-1000-4000-8000-000000000001' AND options='{"prize":"yes"}'::jsonb),'redacted voucher attachment not preserved');
  PERFORM pg_temp.check_handoff((SELECT expires_at>=now()+interval '7 days' AND version=2 FROM public.commerce_carts WHERE id='aaaaaaaa-1000-4000-8000-000000000001'),'merged source lifetime/version not renewed');
  PERFORM pg_temp.check_handoff((SELECT expires_at>=now()+interval '7 days' AND revoked_at IS NULL AND cart_id='aaaaaaaa-1000-4000-8000-000000000001' FROM public.commerce_cart_grants WHERE id=(r->>'grantId')::uuid),'receiving canonical grant not renewed');
  PERFORM pg_temp.check_handoff((SELECT state='canceled' FROM public.commerce_carts WHERE id='aaaaaaaa-1000-4000-8000-000000000002') AND (SELECT revoked_at IS NOT NULL FROM public.commerce_cart_grants WHERE id='bbbbbbbb-1000-4000-8000-000000000002'),'receiver generation not retired');
  PERFORM pg_temp.check_handoff(EXISTS(SELECT 1 FROM public.commerce_cart_events WHERE cart_id='aaaaaaaa-1000-4000-8000-000000000001' AND version=2 AND operation_id='review-attempt'),'canonical merge omitted outbox');
  replay:=public.commerce_cart_redeem_handoff('review-merge','cccccccc-1000-4000-8000-000000000001','review-attempt','merge','native','aaaaaaaa-1000-4000-8000-000000000002',1,1,'[{"item":{"productId":"44444444-4444-4444-8444-444444444444"},"quantity":2},{"item":{"productId":"44444444-4444-4444-8444-444444444444","options":{"prize":"yes"}},"quantity":1}]','[]');
  PERFORM pg_temp.check_handoff(replay->>'ok'='true' AND replay->>'replayed'='true' AND replay->>'grantId'=r->>'grantId','old-proof merge response loss did not replay');
 EXCEPTION WHEN numeric_value_out_of_range THEN PERFORM pg_temp.check_handoff(false,'negotiation minor units overflow integer'); END;
END $$;
SET request.jwt.claims='{"role":"commerce_cart_shopper","exp":9999999999,"cart_scope":"bootstrap","cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"review-bootstrap"}';
DO $$ DECLARE r jsonb; BEGIN
 r:=public.commerce_cart_redeem_handoff('review-keep','cccccccc-1000-4000-8000-000000000002','review-empty','keep_existing','native',NULL,NULL,NULL,NULL,'[]');
 PERFORM pg_temp.check_handoff(r->>'ok'='true','cartless keep rejected');
 r:=public.commerce_cart_redeem_handoff('review-keep','cccccccc-1000-4000-8000-000000000002','review-empty','keep_existing','native',NULL,NULL,NULL,NULL,'[]');
 PERFORM pg_temp.check_handoff(r->>'ok'='true' AND r->>'replayed'='true' AND r->>'state' IS NULL,'cartless keep response loss did not replay');
 r:=public.commerce_cart_redeem_handoff('review-expired','cccccccc-1000-4000-8000-000000000003','review-expired-attempt','connect','native',NULL,1,NULL,NULL,'[]');
 PERFORM pg_temp.check_handoff(r->>'code'='expired','handoff resurrected expired source');
END $$;
DO $$ DECLARE failures text; BEGIN SELECT string_agg(message,E'\n') INTO failures FROM handoff_review_failures; IF failures IS NOT NULL THEN RAISE EXCEPTION E'Handoff regressions:\n%',failures; END IF; END $$;
