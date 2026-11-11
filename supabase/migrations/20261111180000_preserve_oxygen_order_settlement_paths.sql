-- Permit a wallet return after a safe Oxygen exit and known replacement
-- settlement, while retaining all historical Oxygen liability checks.
DO $$
DECLARE
 definition text := pg_get_functiondef(
  'oxygen_private.safe_terminal_wallet_return(uuid,uuid,uuid,uuid,numeric,text,text,text)'::regprocedure
 );
 needle text := 'OR EXISTS(SELECT 1 FROM public.transactions t WHERE t.order_id=p_order_id AND t.transaction_type=''payment'')';
BEGIN
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN
  RAISE EXCEPTION 'Unexpected Oxygen wallet return payment evidence guard';
 END IF;
 EXECUTE replace(definition,needle,$replacement$
 OR EXISTS (
  SELECT 1 FROM public.transactions t
  WHERE t.order_id=p_order_id AND t.transaction_type='payment'
  AND (
   t.merchant_id IS DISTINCT FROM o.merchant_id
   OR coalesce(t.gateway,'') NOT IN ('paystack','korapay','juicyway','kuda','manual','credit_direct','redvault','wallet','store_credit')
   OR coalesce(t.status,'') NOT IN ('completed','refunded','refund_pending')
  )
 )
 $replacement$);
END $$;

-- An amount_paid change requires authority from the manual payment RPC itself.
-- Authenticated transaction inserts cannot create this private proof.
CREATE TABLE oxygen_private.manual_settlement_proofs (
 order_id uuid PRIMARY KEY REFERENCES public.orders(id),
 transaction_id xid8 NOT NULL,
 amount_paid numeric NOT NULL
);
ALTER TABLE oxygen_private.manual_settlement_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oxygen_private.manual_settlement_proofs FROM PUBLIC,anon,authenticated,service_role;
CREATE POLICY deny_direct_manual_settlement_proofs
 ON oxygen_private.manual_settlement_proofs AS RESTRICTIVE
 TO anon,authenticated,service_role USING (false) WITH CHECK (false);

CREATE FUNCTION oxygen_private.stage_manual_settlement(p_order_id uuid,p_amount_paid numeric)
RETURNS void LANGUAGE sql SET search_path='' AS $$
 INSERT INTO oxygen_private.manual_settlement_proofs(order_id,transaction_id,amount_paid)
 SELECT o.id,pg_catalog.pg_current_xact_id(),p_amount_paid
 FROM public.orders o
 WHERE o.id=p_order_id AND o.payment_method='oxygen'
 AND o.cancelled_at IS NULL AND o.shipping_status IS DISTINCT FROM 'cancelled'
 AND o.payment_status IS DISTINCT FROM 'refunded'
 AND p_amount_paid>coalesce(o.amount_paid,0)
 AND EXISTS(SELECT 1 FROM public.oxygen_workflows w WHERE w.order_id=o.id);
$$;
REVOKE ALL ON FUNCTION oxygen_private.stage_manual_settlement(uuid,numeric) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION oxygen_private.guard_order_wallet_for_oxygen()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE basis_unchanged boolean;
BEGIN
 basis_unchanged :=
  ROW(NEW.wallet_amount_used,NEW.total,NEW.customer_id,NEW.merchant_id,NEW.currency)
  IS NOT DISTINCT FROM ROW(OLD.wallet_amount_used,OLD.total,OLD.customer_id,OLD.merchant_id,OLD.currency);

 IF basis_unchanged AND (NEW.amount_paid IS NOT DISTINCT FROM OLD.amount_paid
  OR (NEW.payment_method IS DISTINCT FROM 'oxygen' AND OLD.payment_method IS DISTINCT FROM 'oxygen')) THEN RETURN NEW; END IF;
 PERFORM oxygen_private.credit_admission_lock(NEW.id);
 IF EXISTS(SELECT 1 FROM oxygen_private.funding_snapshots WHERE order_id=NEW.id)
 OR EXISTS(SELECT 1 FROM public.oxygen_workflows WHERE order_id=NEW.id) THEN
  IF basis_unchanged AND OLD.payment_method='oxygen' AND NEW.payment_method='oxygen'
  AND NEW.amount_paid>coalesce(OLD.amount_paid,0) AND NEW.amount_paid<=NEW.total THEN
   DELETE FROM oxygen_private.manual_settlement_proofs p
   WHERE p.order_id=NEW.id AND p.transaction_id=pg_catalog.pg_current_xact_id_if_assigned()
   AND p.amount_paid=NEW.amount_paid;
   IF FOUND THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'oxygen_funding_snapshot_changed' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

-- Preserve the existing authorization, amount and idempotency rules. The two
-- updates follow the ledger insert or verification of its idempotent replay.
DO $$
DECLARE
 definition text := pg_get_functiondef(
  'public.record_manual_order_payment(uuid,uuid,numeric,text,text,text,jsonb,text)'::regprocedure
 );
 update_needle text := 'UPDATE public.orders AS o' || chr(10);
 cleanup_needle text := 'INTO v_payment_status, v_shipping_status, v_cancelled_at;';
BEGIN
 IF (length(definition)-length(replace(definition,update_needle,'')))/length(update_needle)<>2
 OR (length(definition)-length(replace(definition,cleanup_needle,'')))/length(cleanup_needle)<>2 THEN
  RAISE EXCEPTION 'Unexpected manual payment order update';
 END IF;
 definition := replace(definition,update_needle,
  'PERFORM oxygen_private.stage_manual_settlement(p_order_id,v_new_paid);' || chr(10) || '  ' || update_needle);
 EXECUTE replace(definition,cleanup_needle,cleanup_needle || $cleanup$

  DELETE FROM oxygen_private.manual_settlement_proofs p
  WHERE p.order_id=p_order_id AND p.transaction_id=pg_catalog.pg_current_xact_id_if_assigned();
 $cleanup$);
END $$;
