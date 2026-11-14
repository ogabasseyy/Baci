-- Disposable, provider-free regression for Oxygen's payment-rail boundary.
DO $$ BEGIN
 BEGIN
  UPDATE public.orders SET payment_method='oxygen'
   WHERE id='00000000-0000-4000-8000-000000000001';
  RAISE EXCEPTION 'An existing gateway order entered Oxygen' USING ERRCODE='P1001';
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM <> 'oxygen_previous_payment_unresolved' THEN RAISE; END IF;
 END;
 BEGIN
  INSERT INTO public.oxygen_workflows VALUES
   ('10000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000003');
  RAISE EXCEPTION 'An unverified legacy Oxygen order was admitted' USING ERRCODE='P1002';
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM <> 'oxygen_payment_origin_unverified' THEN RAISE; END IF;
 END;
END $$;

-- A newly created Oxygen order is admitted, but once it leaves Oxygen it
-- cannot re-enter while another provider might hold a payment session.
INSERT INTO public.orders VALUES ('00000000-0000-4000-8000-000000000020','oxygen',0);
INSERT INTO public.oxygen_workflows VALUES
 ('10000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000020');
INSERT INTO oxygen_private.commands(workflow_id,status,command) VALUES
 ('10000000-0000-4000-8000-000000000020','queued','{"action":"book"}');
UPDATE public.orders SET payment_method='card' WHERE id='00000000-0000-4000-8000-000000000020';
DO $$ BEGIN
 BEGIN
  UPDATE public.orders SET payment_method='oxygen' WHERE id='00000000-0000-4000-8000-000000000020';
  RAISE EXCEPTION 'A released rail was reclaimed' USING ERRCODE='P1003';
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM <> 'oxygen_previous_payment_unresolved' THEN RAISE; END IF;
 END;
END $$;

-- On old workflows status reads and saving the result of previously sent work
-- remain available, but no new money-changing command may be queued.
INSERT INTO oxygen_private.commands(workflow_id,status,command) VALUES
 ('10000000-0000-4000-8000-000000000030','queued','{"action":"refresh_kyc"}'),
 ('10000000-0000-4000-8000-000000000030','succeeded','{"action":"book"}');
INSERT INTO oxygen_private.payment_recovery(workflow_id,status,action) VALUES
 ('10000000-0000-4000-8000-000000000030','queued','check_status');
DO $$ BEGIN
 BEGIN
  INSERT INTO oxygen_private.commands(workflow_id,status,command) VALUES
   ('10000000-0000-4000-8000-000000000030','queued','{"action":"book"}');
  RAISE EXCEPTION 'Legacy booking was admitted' USING ERRCODE='P1004';
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM <> 'oxygen_payment_origin_unverified' THEN RAISE; END IF;
 END;
 BEGIN
  INSERT INTO oxygen_private.general_activations(workflow_id,status) VALUES
   ('10000000-0000-4000-8000-000000000030','queued');
  RAISE EXCEPTION 'Legacy activation was admitted' USING ERRCODE='P1005';
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM <> 'oxygen_payment_origin_unverified' THEN RAISE; END IF;
 END;
END $$;
