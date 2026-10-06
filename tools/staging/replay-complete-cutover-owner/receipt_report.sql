BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog;
SET LOCAL statement_timeout='10s';
SET LOCAL TIME ZONE 'UTC';
DO $identity$ BEGIN
  IF current_database()<>'postgres' OR session_user<>'supabase_admin'
    OR current_user<>session_user OR inet_client_addr() IS NOT NULL
    OR (SELECT system_identifier::text FROM pg_control_system())<>'7686901100561231906'
    OR clock_timestamp()>='2026-10-06T15:59:10Z'::timestamptz THEN
    RAISE EXCEPTION 'original receipt identity refused';
  END IF;
END $identity$;
SELECT jsonb_build_object(
  'observedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'identity',jsonb_build_object('systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
    'sessionUser',session_user,'currentUser',current_user,'database',current_database(),
    'localUnix',inet_client_addr() IS NULL,'readOnly',current_setting('transaction_read_only')='on'),
  'receiptId',receipt.id,'payloadSha256',receipt.payload_sha256,
  'signatureReceiptId',signature.receipt_id,'signaturePayloadSha256',signature.payload_sha256,
  'receiptCount',(SELECT count(*) FROM public.piggyvest_staging_receipts
    WHERE id='0f9938ae-8551-4e2e-8816-853e0231b2c3'),
  'signatureCount',(SELECT count(*) FROM public.piggyvest_staging_receipt_signatures
    WHERE receipt_id='0f9938ae-8551-4e2e-8816-853e0231b2c3'),
  'signaturePreserved',signature.receipt_id IS NOT NULL,
  'signedPayloadHashMatches',signature.payload_sha256=receipt.payload_sha256,
  'status',receipt.status,'claimTokenPresent',receipt.claim_token IS NOT NULL,
  'leaseExpiresAt',receipt.lease_expires_at,
  'sealed',jsonb_build_object('payloadSha256',receipt.payload_sha256,'ciphertext',receipt.ciphertext,
    'nonce',receipt.nonce,'authTag',receipt.auth_tag,'keyVersion',receipt.key_version),
  'providerSignature',signature.provider_signature)
FROM public.piggyvest_staging_receipts receipt
LEFT JOIN public.piggyvest_staging_receipt_signatures signature ON signature.receipt_id=receipt.id
WHERE receipt.id='0f9938ae-8551-4e2e-8816-853e0231b2c3';
ROLLBACK;
