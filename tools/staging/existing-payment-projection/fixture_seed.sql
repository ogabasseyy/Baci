INSERT INTO prefunded_card.treasury_bindings VALUES
  ('ffffcb16-2e95-5cff-a591-e9cc81cf5f57','d91d9e87-8e0d-44de-9b84-1e1d709633d2',
   '10000000-0000-4000-8000-000000000001','01M2381RG34HQJMHQKE7DWDACR',
   '01M238A0V75387H4HZ15YFWGX3','NGN',10000,0,10000,clock_timestamp(),
   'prefunded_treasury_operator',true);
INSERT INTO piggyvest_staging.wallet_goal_mappings VALUES
  ('d91d9e87-8e0d-44de-9b84-1e1d709633d2','10000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000002','9f01153c-1589-4dde-b9aa-8f644a846832',
   '01M3W0Y93XHJY9RPQ2G75X81WG','c096507d-dc32-45d2-9c01-871a27abfd10');
INSERT INTO prefunded_card.credit_routes(goal_id,integration_id,merchant_id,customer_id,system_identifier) VALUES
  ('9f01153c-1589-4dde-b9aa-8f644a846832','d91d9e87-8e0d-44de-9b84-1e1d709633d2',
   '10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','7685292944002592802');
INSERT INTO prefunded_card.operations(id,integration_id,merchant_id,customer_id,goal_id,treasury_binding_id,
  request_fingerprint,idempotency_key,saved_method_id,amount_kobo,fee_allowance_kobo,currency,
  collection_reference,transfer_reference,destination_wallet_id,destination_customer_id,
  collection_status,transfer_status,collection_fence,transfer_fence,
  collection_provider_transaction_id,transfer_provider_transaction_id,transfer_attempted_at) VALUES
  ('ff561046-58e7-428d-9163-f6e60b0dab65','d91d9e87-8e0d-44de-9b84-1e1d709633d2',
   '10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',
   '9f01153c-1589-4dde-b9aa-8f644a846832','ffffcb16-2e95-5cff-a591-e9cc81cf5f57',
   repeat('b',64),repeat('a',64),'bbbbbbbb-0000-4000-8000-000000000001',10000,0,'NGN',
   'pvb-first-ff561046-58e7-428d-9163-f6e60b0dab65','pvbt-ff561046-58e7-428d-9163-f6e60b0dab65',
   '01M3W0Y93XHJY9RPQ2G75X81WG','c096507d-dc32-45d2-9c01-871a27abfd10',
   'verified_success','verified_success',0,1,'synthetic-collection','PVB01M3YP6SFJQTJQWE83SC5RMX1V',clock_timestamp());
INSERT INTO prefunded_card.checkout_intents(id,operation_id,deployment,integration_id,merchant_id,
  customer_id,actor_id,goal_id,treasury_binding_id,business_id,system_identifier,expires_at,database_name,
  authorized_login,email,amount_kobo,currency,idempotency_key,idempotency_hash,request_fingerprint,
  reference,transfer_reference,prepared_saved_method_id,consent_version,consent_one_time_charge,
  consent_save_card,phase,verified_collection) VALUES
  ('ff561046-58e7-428d-9163-f6e60b0dab65','ff561046-58e7-428d-9163-f6e60b0dab65','staging',
   'd91d9e87-8e0d-44de-9b84-1e1d709633d2','10000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',
   '9f01153c-1589-4dde-b9aa-8f644a846832','ffffcb16-2e95-5cff-a591-e9cc81cf5f57',
   '01M2381RG34HQJMHQKE7DWDACR','7685292944002592802','2026-09-29T15:59:10Z','postgres',
   'prefunded_treasury_operator','fixture@example.invalid',10000,'NGN',
   'bbbbbbbb-0000-4000-8000-000000000002',repeat('a',64),repeat('b',64),
   'pvb-first-ff561046-58e7-428d-9163-f6e60b0dab65','pvbt-ff561046-58e7-428d-9163-f6e60b0dab65',
   'bbbbbbbb-0000-4000-8000-000000000001','prefunded-first-card-v1',true,true,'funding_pending',
   '{"fixture":"synthetic-only"}');
UPDATE prefunded_card.dispatch_queue SET attempts=4,available_at=clock_timestamp()-interval '1 second';
GRANT USAGE ON SCHEMA prefunded_card TO prefunded_treasury_operator;
GRANT EXECUTE ON FUNCTION prefunded_card.claim_due(uuid,text,text,integer,uuid,uuid),
  prefunded_card.finish_dispatch(uuid,uuid,text),prefunded_card.project(uuid,text)
  TO prefunded_treasury_operator;
