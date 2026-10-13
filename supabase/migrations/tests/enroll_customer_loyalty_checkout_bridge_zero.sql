-- Zero-discount claim guard (bridge): a percentage or cap computation
-- that rounds to zero must reject before the claim, never consume a
-- paid code for no discount. Pinned on the definition (the stub suite
-- cannot model full orders; see case 25c).
SELECT pg_temp.assert_true(
  (SELECT strpos(def, 'IF v_expected <= 0 THEN') > 0
     AND strpos(def, 'IF v_expected <= 0 THEN')
       < strpos(def, 'abs(v_order.discount_amount - v_expected)')
     AND strpos(
       substring(def FROM strpos(def, 'IF v_expected <= 0 THEN')),
       'loyalty_code_not_applicable'
     ) > 0
   FROM pg_catalog.pg_get_functiondef(
     'public.create_storefront_order_with_loyalty_code(uuid,text,text,jsonb,text,numeric,numeric,numeric,text,text,text,jsonb,text,text,jsonb,uuid,text,text,uuid,text,numeric,numeric,text,text,uuid)'::pg_catalog.regprocedure
   ) AS def),
  'order wrapper claims zero-discount loyalty codes'
);
