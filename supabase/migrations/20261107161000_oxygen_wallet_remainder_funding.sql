-- Wallet is already-paid invoice credit, never Oxygen equity/downpayment.
-- Freeze the admitted invoice basis so every provider path finances one amount.
CREATE TABLE oxygen_private.funding_snapshots (
 order_id uuid PRIMARY KEY REFERENCES public.orders(id),
 merchant_id uuid NOT NULL, customer_id uuid NOT NULL,
 gross_amount numeric NOT NULL CHECK(gross_amount>0 AND gross_amount::text NOT IN ('NaN','Infinity','-Infinity')),
 wallet_amount numeric NOT NULL CHECK(wallet_amount>=0),
 financed_amount numeric NOT NULL CHECK(financed_amount>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(gross_amount=wallet_amount+financed_amount)
);
ALTER TABLE oxygen_private.funding_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oxygen_private.funding_snapshots FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION oxygen_private.validate_wallet_funding(p_order_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o record; wallet numeric;
BEGIN
 PERFORM oxygen_private.credit_admission_lock(p_order_id);
 -- Same nonblocking lock contract as the wallet/payment/projection writers.
 IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('baci_order_payment:'||p_order_id::text,0))
 OR NOT pg_catalog.pg_try_advisory_xact_lock(('x'||pg_catalog.substr(pg_catalog.md5(p_order_id::text),1,16))::bit(64)::bigint)
 OR NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('customer_savings_redemption:'||p_order_id::text,0)) THEN
  RAISE EXCEPTION 'oxygen_credit_check_unavailable' USING ERRCODE='40001';
 END IF;
 SELECT id,merchant_id,customer_id,total,currency,wallet_amount_used,amount_paid INTO o FROM public.orders WHERE id=p_order_id;
 IF NOT FOUND OR o.total IS NULL OR o.total<=0 OR o.total::text IN ('NaN','Infinity','-Infinity')
 OR o.currency IS DISTINCT FROM 'NGN' OR o.customer_id IS NULL
 OR EXISTS(SELECT 1 FROM public.customer_savings_redemptions WHERE order_id=p_order_id)
 OR EXISTS(SELECT 1 FROM public.customer_wallet_transactions t WHERE t.source_id=p_order_id
  AND t.source_type IN ('order_redemption','order_refund','order_reversal') AND
  (t.source_type IN ('order_refund','order_reversal') OR t.type IS DISTINCT FROM 'redemption' OR t.status IS DISTINCT FROM 'completed' OR t.amount IS NULL OR t.amount<=0
   OR t.amount::text IN ('NaN','Infinity','-Infinity')
   OR t.customer_id IS DISTINCT FROM o.customer_id OR t.merchant_id IS DISTINCT FROM o.merchant_id)) THEN
  RAISE EXCEPTION 'oxygen_local_credit_in_use' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(sum(amount),0) INTO wallet FROM public.customer_wallet_transactions
 WHERE source_id=p_order_id AND source_type='order_redemption' AND type='redemption' AND status='completed';
 IF wallet IS DISTINCT FROM coalesce(o.wallet_amount_used,0) OR wallet IS DISTINCT FROM coalesce(o.amount_paid,0)
 OR wallet<0 OR wallet>=o.total THEN
  RAISE EXCEPTION 'oxygen_local_credit_in_use' USING ERRCODE='23514';
 END IF;
 RETURN wallet;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.validate_wallet_funding(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Existing clean, uncredited workflows retain their original gross basis.
-- Conflicting legacy evidence is deliberately left without an admission proof.
INSERT INTO oxygen_private.funding_snapshots(order_id,merchant_id,customer_id,gross_amount,wallet_amount,financed_amount)
 SELECT o.id,o.merchant_id,o.customer_id,o.total,0,o.total FROM public.orders o
 JOIN public.oxygen_workflows w ON w.order_id=o.id
 WHERE o.total>0 AND o.total::text NOT IN ('NaN','Infinity','-Infinity') AND o.currency='NGN'
 AND o.customer_id IS NOT NULL AND coalesce(o.wallet_amount_used,0)=0 AND coalesce(o.amount_paid,0)=0
 AND NOT EXISTS(SELECT 1 FROM public.customer_wallet_transactions t WHERE t.source_id=o.id AND t.source_type IN ('order_redemption','order_refund','order_reversal'))
 AND NOT EXISTS(SELECT 1 FROM public.customer_savings_redemptions s WHERE s.order_id=o.id);

CREATE FUNCTION oxygen_private.capture_wallet_funding()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE wallet numeric;
BEGIN
 wallet:=oxygen_private.validate_wallet_funding(NEW.order_id);
 INSERT INTO oxygen_private.funding_snapshots(order_id,merchant_id,customer_id,gross_amount,wallet_amount,financed_amount)
 SELECT id,merchant_id,customer_id,total,wallet,total-wallet FROM public.orders WHERE id=NEW.order_id
 ON CONFLICT(order_id) DO NOTHING;
 PERFORM oxygen_private.assert_no_local_credit(NEW.order_id);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.capture_wallet_funding() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER oxygen_aaa_funding_snapshot BEFORE INSERT ON public.oxygen_workflows
 FOR EACH ROW EXECUTE FUNCTION oxygen_private.capture_wallet_funding();

CREATE OR REPLACE FUNCTION oxygen_private.assert_no_local_credit(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE wallet numeric;
BEGIN
 wallet:=oxygen_private.validate_wallet_funding(p_order_id);
 IF NOT EXISTS(SELECT 1 FROM oxygen_private.funding_snapshots s JOIN public.orders o ON o.id=s.order_id
  WHERE s.order_id=p_order_id AND s.merchant_id=o.merchant_id AND s.customer_id=o.customer_id
   AND s.gross_amount=o.total AND s.wallet_amount=wallet AND s.financed_amount=o.total-wallet)
 AND EXISTS(SELECT 1 FROM public.oxygen_workflows WHERE order_id=p_order_id) THEN
  RAISE EXCEPTION 'oxygen_funding_snapshot_changed' USING ERRCODE='23514';
 END IF;
END $$;

-- Status/recovery reads use the admitted basis even for a conflicting legacy
-- workflow. Its mutation admission still fails closed above.
CREATE FUNCTION oxygen_private.financed_amount(p_order_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(s.financed_amount,o.total-coalesce(o.wallet_amount_used,0)) FROM public.orders o
 LEFT JOIN oxygen_private.funding_snapshots s ON s.order_id=o.id WHERE o.id=p_order_id;
$$;
REVOKE ALL ON FUNCTION oxygen_private.financed_amount(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Reconciliation may record a durable review for a real funding conflict.
-- Lock contention remains retryable and must not create a permanent review.
CREATE FUNCTION oxygen_private.funding_snapshot_consistent(p_order_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM oxygen_private.assert_no_local_credit(p_order_id);
 RETURN true;
EXCEPTION WHEN check_violation THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.funding_snapshot_consistent(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Protect the snapshot itself against later helper/worker writes too.
CREATE FUNCTION oxygen_private.reject_funding_snapshot_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 RAISE EXCEPTION 'oxygen_funding_snapshot_immutable' USING ERRCODE='23514';
END $$;
REVOKE ALL ON FUNCTION oxygen_private.reject_funding_snapshot_mutation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER oxygen_funding_snapshot_immutable BEFORE UPDATE OR DELETE ON oxygen_private.funding_snapshots
 FOR EACH ROW EXECUTE FUNCTION oxygen_private.reject_funding_snapshot_mutation();

-- An immutable admission snapshot describes the historical booking basis.
-- A terminal wallet return is separate evidence, allowed only before any
-- possible booking liability. This mirrors the existing safe method-exit
-- fence and binds the return to the single original debit, never caller money.
CREATE FUNCTION oxygen_private.safe_terminal_wallet_return(
 p_order_id uuid,p_wallet_id uuid,p_customer_id uuid,p_merchant_id uuid,
 p_amount numeric,p_source_type text,p_type text,p_status text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o record; w public.oxygen_workflows%ROWTYPE; snapshot record;
BEGIN
 IF auth.uid() IS NULL OR p_status IS DISTINCT FROM 'completed'
 OR NOT ((p_source_type='order_reversal' AND p_type='adjustment')
  OR (p_source_type='order_refund' AND p_type='refund')) THEN RETURN false; END IF;
 SELECT r.id,r.merchant_id,r.customer_id,r.payment_method,r.shipping_status,r.cancelled_at
 INTO o FROM public.orders r WHERE r.id=p_order_id FOR SHARE;
 IF NOT FOUND OR o.cancelled_at IS NULL OR o.shipping_status NOT IN ('cancelled','canceled')
 OR o.payment_method IS NULL OR o.payment_method='oxygen'
 OR o.customer_id IS DISTINCT FROM p_customer_id OR o.merchant_id IS DISTINCT FROM p_merchant_id
 OR NOT (EXISTS(SELECT 1 FROM public.customers c WHERE c.id=o.customer_id AND c.merchant_id=o.merchant_id AND c.user_id=auth.uid())
  OR EXISTS(SELECT 1 FROM public.merchants m WHERE m.id=o.merchant_id AND m.user_id=auth.uid())
  OR public.check_staff_permission(auth.uid(),o.merchant_id,'orders','edit')) THEN RETURN false; END IF;
 SELECT * INTO w FROM public.oxygen_workflows WHERE order_id=p_order_id FOR UPDATE;
 IF NOT FOUND OR w.stage NOT IN ('application_required','eligibility_required','kyc_required','plan_required')
 OR w.customer_id IS DISTINCT FROM o.customer_id OR w.merchant_id IS DISTINCT FROM o.merchant_id
 OR EXISTS(SELECT 1 FROM oxygen_private.commands c WHERE c.workflow_id=w.id AND
  (c.status IN ('queued','executing','indeterminate') OR coalesce(c.command->>'action','') NOT IN
   ('start_application','validate_customer','resend_customer_otp','refresh_eligibility','refresh_kyc','validate_nin','selfie_link')))
 OR EXISTS(SELECT 1 FROM oxygen_private.provider_states s WHERE s.workflow_id=w.id AND (s.state ? 'bookingReference' OR s.state ? 'booking'))
 OR EXISTS(SELECT 1 FROM oxygen_private.provider_reference_history h WHERE h.workflow_id=w.id AND h.booking_reference IS NOT NULL)
 OR EXISTS(SELECT 1 FROM oxygen_private.saved_plans p WHERE p.workflow_id=w.id)
 OR EXISTS(SELECT 1 FROM oxygen_private.plan_selections p WHERE p.workflow_id=w.id)
 OR EXISTS(SELECT 1 FROM oxygen_private.payment_recovery p WHERE p.workflow_id=w.id)
 OR EXISTS(SELECT 1 FROM oxygen_private.activation_trials a WHERE a.workflow_id=w.id)
 OR EXISTS(SELECT 1 FROM oxygen_private.general_activations a WHERE a.workflow_id=w.id)
 OR EXISTS(SELECT 1 FROM public.transactions t WHERE t.order_id=p_order_id AND t.transaction_type='payment') THEN RETURN false; END IF;
 SELECT * INTO snapshot FROM oxygen_private.funding_snapshots WHERE order_id=p_order_id;
 IF NOT FOUND OR snapshot.wallet_amount<=0 OR snapshot.wallet_amount IS DISTINCT FROM p_amount
 OR snapshot.customer_id IS DISTINCT FROM p_customer_id OR snapshot.merchant_id IS DISTINCT FROM p_merchant_id
 OR EXISTS(SELECT 1 FROM public.customer_wallet_transactions t WHERE t.source_id=p_order_id
   AND t.source_type IN ('order_reversal','order_refund'))
 OR (SELECT count(*) FROM public.customer_wallet_transactions t WHERE t.source_id=p_order_id AND t.source_type='order_redemption')<>1 THEN RETURN false; END IF;
 RETURN EXISTS(SELECT 1 FROM public.customer_wallet_transactions t JOIN public.customer_wallets b ON b.id=t.wallet_id
  WHERE t.source_id=p_order_id AND t.source_type='order_redemption' AND t.type='redemption' AND t.status='completed'
  AND t.amount=p_amount AND t.wallet_id=p_wallet_id AND t.customer_id=p_customer_id AND t.merchant_id=p_merchant_id
  AND b.customer_id=p_customer_id AND b.merchant_id=p_merchant_id);
END $$;
REVOKE ALL ON FUNCTION oxygen_private.safe_terminal_wallet_return(uuid,uuid,uuid,uuid,numeric,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION oxygen_private.guard_local_credit_for_oxygen()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_old uuid; v_new uuid; v_order uuid;
BEGIN
 IF TG_OP='UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='customer_wallet_transactions' THEN
  IF TG_OP<>'INSERT' AND OLD.source_type IN ('order_redemption','order_refund','order_reversal') THEN v_old:=OLD.source_id; END IF;
  IF TG_OP<>'DELETE' AND NEW.source_type IN ('order_redemption','order_refund','order_reversal') THEN v_new:=NEW.source_id; END IF;
 ELSE
  IF TG_OP<>'INSERT' THEN v_old:=OLD.order_id; END IF;
  IF TG_OP<>'DELETE' THEN v_new:=NEW.order_id; END IF;
 END IF;
 FOR v_order IN SELECT DISTINCT x FROM unnest(ARRAY[v_old,v_new]) AS t(x) WHERE x IS NOT NULL ORDER BY x LOOP
  PERFORM oxygen_private.credit_admission_lock(v_order);
  IF EXISTS(SELECT 1 FROM public.oxygen_workflows WHERE order_id=v_order)
  OR EXISTS(SELECT 1 FROM oxygen_private.funding_snapshots WHERE order_id=v_order)
  OR (TG_TABLE_NAME='customer_savings_redemptions' AND EXISTS(SELECT 1 FROM public.orders WHERE id=v_order AND payment_method='oxygen')) THEN
   IF TG_TABLE_NAME='customer_wallet_transactions' AND TG_OP='INSERT' THEN
    IF oxygen_private.safe_terminal_wallet_return(v_order,NEW.wallet_id,NEW.customer_id,NEW.merchant_id,NEW.amount,NEW.source_type,NEW.type,NEW.status) THEN
     CONTINUE;
    END IF;
   END IF;
   RAISE EXCEPTION 'oxygen_local_credit_in_use' USING ERRCODE='23514';
  END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER oxygen_local_wallet_credit_guard ON public.customer_wallet_transactions;
CREATE TRIGGER oxygen_local_wallet_credit_guard BEFORE INSERT OR UPDATE OR DELETE ON public.customer_wallet_transactions
 FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_local_credit_for_oxygen();
DROP TRIGGER oxygen_local_savings_credit_guard ON public.customer_savings_redemptions;
CREATE TRIGGER oxygen_local_savings_credit_guard BEFORE INSERT OR UPDATE OR DELETE ON public.customer_savings_redemptions
 FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_local_credit_for_oxygen();

CREATE OR REPLACE FUNCTION oxygen_private.guard_order_wallet_for_oxygen()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF ROW(NEW.wallet_amount_used,NEW.total,NEW.customer_id,NEW.merchant_id,NEW.currency)
 IS NOT DISTINCT FROM ROW(OLD.wallet_amount_used,OLD.total,OLD.customer_id,OLD.merchant_id,OLD.currency)
 AND (NEW.amount_paid IS NOT DISTINCT FROM OLD.amount_paid
  OR (NEW.payment_method IS DISTINCT FROM 'oxygen' AND OLD.payment_method IS DISTINCT FROM 'oxygen')) THEN RETURN NEW; END IF;
 PERFORM oxygen_private.credit_admission_lock(NEW.id);
 IF EXISTS(SELECT 1 FROM oxygen_private.funding_snapshots WHERE order_id=NEW.id)
 OR EXISTS(SELECT 1 FROM public.oxygen_workflows WHERE order_id=NEW.id) THEN
  RAISE EXCEPTION 'oxygen_funding_snapshot_changed' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER oxygen_order_wallet_credit_guard ON public.orders;
CREATE TRIGGER oxygen_order_wallet_credit_guard BEFORE UPDATE ON public.orders
 FOR EACH ROW EXECUTE FUNCTION oxygen_private.guard_order_wallet_for_oxygen();

-- Amend exact current definitions, preserving accumulated authorization,
-- environment, pilot, original-rail, retry, and settlement fences.
DO $$
DECLARE target record; definition text; needle text; replacement text;
BEGIN
 FOR target IN SELECT * FROM (VALUES
 ('oxygen_private.start_workflow(uuid,text)','o.total, o.currency','oxygen_private.financed_amount(o.id) AS total, o.currency'),
 ('oxygen_private.runtime(text,uuid,jsonb)','SELECT o.total,o.customer_phone','SELECT oxygen_private.financed_amount(o.id) AS total,o.customer_phone'),
 ('public.oxygen_saved_plans(uuid,uuid)','SELECT o.total INTO amount','SELECT oxygen_private.financed_amount(o.id) INTO amount'),
 ('public.oxygen_accept_saved_plan(uuid,uuid,integer)','SELECT o.total,o.currency','SELECT oxygen_private.financed_amount(o.id) AS total,o.currency'),
 ('oxygen_private.reconcile_activation(uuid,uuid)','SELECT o1.id,o1.total,o1.currency','SELECT o1.id,oxygen_private.financed_amount(o1.id) AS total,o1.currency'),
 ('oxygen_private.general_activation(text,uuid,jsonb)','SELECT o1.total,o1.currency','SELECT oxygen_private.financed_amount(o1.id) AS total,o1.currency'),
 ('oxygen_private.general_activation_reconcile_conflict(uuid)','SELECT o1.total,o1.currency','SELECT oxygen_private.financed_amount(o1.id) AS total,o1.currency'),
 ('oxygen_private.authorize_staging_approval_retry(uuid,uuid,uuid,integer,text)','AND o.total=(s->','AND oxygen_private.financed_amount(o.id)=(s->')
 ) AS patches(signature,old_text,new_text) LOOP
  definition:=pg_get_functiondef(target.signature::regprocedure);
  needle:=target.old_text; replacement:=target.new_text;
  IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN
   RAISE EXCEPTION 'Unexpected Oxygen funding projection: %',target.signature;
  END IF;
  EXECUTE replace(definition,needle,replacement);
 END LOOP;
 -- Cached plan acceptance mutates the provider-state selection and therefore
 -- requires the same current funding proof as an enqueued provider operation.
 definition:=pg_get_functiondef('public.oxygen_accept_saved_plan(uuid,uuid,integer)'::regprocedure);
 needle:=' SELECT state INTO current_state FROM oxygen_private.provider_states';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Oxygen cached plan proof'; END IF;
 EXECUTE replace(definition,needle,' PERFORM oxygen_private.assert_no_local_credit(w.order_id);'||chr(10)||needle);
 definition:=pg_get_functiondef('oxygen_private.general_activation_reconcile_conflict(uuid)'::regprocedure);
 needle:=' IF o.total IS NULL OR o.total<=0';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Oxygen general reconciliation proof'; END IF;
 EXECUTE replace(definition,needle,' IF NOT oxygen_private.funding_snapshot_consistent(w.order_id) OR o.total IS NULL OR o.total<=0');
 -- The staging trial historically verified only the reference. Before dispatch,
 -- also bind its live booking to the same admitted invoice remainder.
 definition:=pg_get_functiondef('oxygen_private.activation_trial(text,jsonb)'::regprocedure);
 needle:=' IF p_operation=''enqueue'' THEN';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Oxygen trial admission'; END IF;
 EXECUTE replace(definition,needle,$patch$
 IF p_operation IN ('enqueue','claim') THEN
  PERFORM oxygen_private.assert_no_local_credit(w.order_id);
  IF NOT EXISTS(SELECT 1 FROM oxygen_private.provider_states s WHERE s.workflow_id=w.id
   AND CASE WHEN pg_catalog.pg_input_is_valid(s.state->'booking'->>'product_amount','numeric')
    THEN (s.state->'booking'->>'product_amount')::numeric=oxygen_private.financed_amount(w.order_id) ELSE false END) THEN
   RAISE EXCEPTION 'Trial binding changed' USING ERRCODE='40001';
  END IF;
 END IF;
 IF p_operation='enqueue' THEN$patch$);
 -- Save returned trial evidence first; canonical reconciliation decides whether
 -- it is consistent. Activation confirmation still never marks merchant paid.
 definition:=pg_get_functiondef('oxygen_private.reconcile_activation(uuid,uuid)'::regprocedure);
 needle:=' IF w.stage=''activated'' AND s->''booking''->>''status''=''ACTIVATED''';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Oxygen trial reconciliation'; END IF;
 EXECUTE replace(definition,needle,$patch$
 PERFORM oxygen_private.assert_no_local_credit(w.order_id);
 IF a.result ? 'product_amount' AND
  (CASE WHEN pg_catalog.pg_input_is_valid(a.result->>'product_amount','numeric')
   THEN (a.result->>'product_amount')::numeric IS DISTINCT FROM o.total ELSE true END) THEN
  RAISE EXCEPTION 'Activation binding changed' USING ERRCODE='40001';
 END IF;
 IF w.stage='activated' AND s->'booking'->>'status'='ACTIVATED'$patch$);
END $$;
NOTIFY pgrst,'reload schema';
