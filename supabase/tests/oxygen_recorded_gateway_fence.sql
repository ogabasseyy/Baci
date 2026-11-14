-- Synthetic rollback-only contract for recorded gateway evidence.
BEGIN;
INSERT INTO public.orders VALUES ('00000000-0000-4000-8000-000000000011','paystack',0),('00000000-0000-4000-8000-000000000012','paystack',0);
INSERT INTO public.transactions(order_id,transaction_type,status) VALUES ('00000000-0000-4000-8000-000000000011','payment','failed');
DO $$ BEGIN
 BEGIN UPDATE public.orders SET payment_method='oxygen' WHERE id='00000000-0000-4000-8000-000000000011'; RAISE EXCEPTION 'Recorded gateway was not fenced';
 EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'oxygen_gateway_payment_in_use' THEN RAISE; END IF; END;
 BEGIN INSERT INTO public.oxygen_workflows VALUES (gen_random_uuid(),'00000000-0000-4000-8000-000000000011'); RAISE EXCEPTION 'Workflow with recorded gateway was not fenced';
 EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'oxygen_gateway_payment_in_use' THEN RAISE; END IF; END;
 UPDATE public.orders SET payment_method='oxygen' WHERE id='00000000-0000-4000-8000-000000000012';
 INSERT INTO public.oxygen_workflows VALUES ('10000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000012');
 INSERT INTO public.transactions(order_id,transaction_type,status) VALUES ('00000000-0000-4000-8000-000000000012','payment','pending');
 BEGIN INSERT INTO oxygen_private.commands(workflow_id,status) VALUES ('10000000-0000-4000-8000-000000000012','queued'); RAISE EXCEPTION 'Command with recorded gateway was not fenced';
 EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'oxygen_gateway_payment_in_use' THEN RAISE; END IF; END;
 INSERT INTO oxygen_private.commands(workflow_id,status,command) VALUES ('10000000-0000-4000-8000-000000000012','queued','{"action":"refresh_kyc"}'),('10000000-0000-4000-8000-000000000012','executing','{"action":"refresh_payment_setup"}');
 INSERT INTO oxygen_private.payment_recovery(workflow_id,status,action) VALUES ('10000000-0000-4000-8000-000000000012','queued','check_status');
 BEGIN INSERT INTO oxygen_private.payment_recovery(workflow_id,status,action) VALUES ('10000000-0000-4000-8000-000000000012','queued','resend_upfront'); RAISE EXCEPTION 'Mutating recovery was not fenced';
 EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'oxygen_gateway_payment_in_use' THEN RAISE; END IF; END;
 BEGIN UPDATE oxygen_private.commands SET command='{"action":"book"}' WHERE command->>'action'='refresh_kyc'; RAISE EXCEPTION 'Command rebound to mutation';
 EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'oxygen_gateway_payment_in_use' THEN RAISE; END IF; END;
 BEGIN UPDATE oxygen_private.payment_recovery SET action='resend_upfront' WHERE action='check_status'; RAISE EXCEPTION 'Recovery rebound to mutation';
 EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'oxygen_gateway_payment_in_use' THEN RAISE; END IF; END;
 -- Existing local credit and gateway evidence must not suppress status reads.
 -- Seed a legacy conflict only in this disposable test database.
 ALTER TABLE public.customer_wallet_transactions DISABLE TRIGGER oxygen_local_wallet_credit_guard;
 INSERT INTO public.customer_wallet_transactions(source_id,source_type,type) VALUES ('00000000-0000-4000-8000-000000000012','order_redemption','redemption');
 ALTER TABLE public.customer_wallet_transactions ENABLE TRIGGER oxygen_local_wallet_credit_guard;
 INSERT INTO oxygen_private.commands(workflow_id,status,command) VALUES ('10000000-0000-4000-8000-000000000012','queued','{"action":"refresh_kyc"}'),('10000000-0000-4000-8000-000000000012','executing','{"action":"refresh_payment_setup"}');
 INSERT INTO oxygen_private.payment_recovery(workflow_id,status,action) VALUES ('10000000-0000-4000-8000-000000000012','executing','check_status');
 BEGIN INSERT INTO oxygen_private.commands(workflow_id,status,command) VALUES ('10000000-0000-4000-8000-000000000012','queued','{"action":"book"}'); RAISE EXCEPTION 'Conflicted booking was not fenced';
 EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'oxygen_local_credit_in_use' THEN RAISE; END IF; END;
 BEGIN INSERT INTO oxygen_private.payment_recovery(workflow_id,status,action) VALUES ('10000000-0000-4000-8000-000000000012','queued','resend_upfront'); RAISE EXCEPTION 'Conflicted resend was not fenced';
 EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'oxygen_local_credit_in_use' THEN RAISE; END IF; END;
 BEGIN UPDATE oxygen_private.commands SET command='{"action":"book"}' WHERE command->>'action'='refresh_kyc'; RAISE EXCEPTION 'Conflicted read rebound to mutation';
 EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'oxygen_local_credit_in_use' THEN RAISE; END IF; END;
 BEGIN UPDATE oxygen_private.payment_recovery SET action='resend_upfront' WHERE action='check_status'; RAISE EXCEPTION 'Conflicted recovery rebound to mutation';
 EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'oxygen_local_credit_in_use' THEN RAISE; END IF; END;
 -- Rebinding a mutating command from a clean workflow must recheck the destination.
 INSERT INTO public.orders VALUES ('00000000-0000-4000-8000-000000000014','paystack',0);
 INSERT INTO public.oxygen_workflows VALUES ('10000000-0000-4000-8000-000000000014','00000000-0000-4000-8000-000000000014');
 INSERT INTO oxygen_private.commands(workflow_id,status,command) VALUES ('10000000-0000-4000-8000-000000000014','queued','{"action":"book"}');
 BEGIN UPDATE oxygen_private.commands SET workflow_id='10000000-0000-4000-8000-000000000012' WHERE workflow_id='10000000-0000-4000-8000-000000000014'; RAISE EXCEPTION 'Command moved to conflicted order';
 EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'oxygen_local_credit_in_use' THEN RAISE; END IF; END;
 -- Finishing an existing command is allowed to persist reconciliation evidence.
 INSERT INTO oxygen_private.commands(workflow_id,status) VALUES ('10000000-0000-4000-8000-000000000012','succeeded');
END $$;
ROLLBACK;
