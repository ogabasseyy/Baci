CREATE ROLE piggyvest_exit_evidence_writer LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE FUNCTION savings_exit_execution_test.begin_exit(goal_number integer, chosen_action text) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT piggyvest_savings_exit_execution.begin('40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',goal_policy_test.goal(goal_number),
    'synthetic-business','90000000-0000-4000-8000-000000000001',goal_policy_test.goal(4000+goal_number),chosen_action,
    jsonb_build_object('policyId',('70000000-0000-4000-8000-'||lpad(goal_number::text,12,'0'))::uuid));
$$;
CREATE FUNCTION savings_exit_execution_test.consume(goal_number integer, chosen_action text) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT piggyvest_savings_exit_execution.consume_evidence('40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',goal_policy_test.goal(goal_number),
    'synthetic-business','90000000-0000-4000-8000-000000000001',goal_policy_test.goal(4000+goal_number),chosen_action);
$$;
CREATE FUNCTION savings_exit_execution_test.provider_receipt(goal_number integer) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT jsonb_build_object('eventId','independent-event-'||goal_number,'providerTransactionId','independent-transaction-'||goal_number,
    'providerCustomerId','customer-'||goal_number,'reference',goal_policy_test.goal(4000+goal_number),
    'sourceWalletId','goal-'||goal_number||'-wallet',
    'destinationWalletId',CASE WHEN goal_number=212 THEN 'merchant-wallet' ELSE 'customer-wallet' END,
    'businessId','synthetic-business','currency','NGN','amountKobo',CASE WHEN goal_number=212 THEN 99150 ELSE 100 END,
    'feeKobo',0,'payloadSha256',CASE WHEN goal_number=212
      THEN 'eac6a76b3898c1fc7c621860d10c6d149d43d00955f97da311fde7d8a78e59cf'
      ELSE 'b00352ad9d72672cad6195cbda64ba4f96253e1c98e319281bc5f43f681dc2f2' END);
$$;
CREATE FUNCTION savings_exit_execution_test.store(goal_number integer, changes jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT piggyvest_savings_exit_execution.record_evidence('40000000-0000-4000-8000-000000000001',
    savings_exit_execution_test.provider_receipt(goal_number)||changes);
$$;
CREATE TABLE savings_exit_execution_test.fail_receipts(enabled boolean);
CREATE FUNCTION savings_exit_execution_test.fail_last_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM savings_exit_execution_test.fail_receipts WHERE enabled) THEN
    RAISE EXCEPTION 'synthetic accounting receipt failure' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

INSERT INTO public.orders(id,merchant_id,customer_id,order_number,shipping_status,payment_status,total,currency,
  subtotal,shipping_fee,tax_amount,discount_amount,amount_paid)
VALUES('80000000-0000-4000-8000-000000000212','10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001','SYNTHETIC-EXIT-212','pending','unpaid',991.50,'NGN',970,20,1,0,0);
INSERT INTO public.order_items(order_id,product_id,variant_id,quantity,price,name)
VALUES('80000000-0000-4000-8000-000000000212','50000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',1,970,'Synthetic phone');
