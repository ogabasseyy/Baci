SELECT set_config('fixture.release_request', jsonb_build_object(
  'generationId', i.active_generation_id, 'catalogueRevision', i.catalogue_revision::text,
  'servingRevision', i.serving_revision::text, 'credentialRevision', i.credential_revision::text,
  'credentialId', c.id, 'payloadDigest', g.payload_digest, 'configurationRevision', 'config-r8',
  'runId', 'run-18', 'attemptId', 'attempt-1', 'stagedResultId', 'result-1',
  'verificationId', 'd0000000-0000-4000-8000-000000000001',
  'applicationDeadline', private.brilstash_clock() + interval '5 minutes'
)::text, true)
FROM private.brilstash_installations i
JOIN private.brilstash_generations g ON g.installation_id = i.id AND g.id = i.active_generation_id
JOIN private.brilstash_credentials c ON c.installation_id = i.id
WHERE i.id = '30000000-0000-4000-8000-000000000001';

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  installation uuid := '30000000-0000-4000-8000-000000000001';
  requested jsonb := current_setting('fixture.release_request')::jsonb;
  release_id uuid;
  probe_id uuid;
  verification_id uuid;
  saved_verification_id uuid;
  readback_id uuid := 'f1000000-0000-4000-8000-000000000001';
  saved_request uuid := 'e0000000-0000-4000-8000-000000000003';
  state jsonb;
  operator_request uuid := 'e0000000-0000-4000-8000-000000000001';
  partner_request uuid := 'e0000000-0000-4000-8000-000000000002';
  feed_url text := 'https://feed.example.invalid/partners/yield/brilpay/products?page=1&limit=100&min_price=0';
  proof text;
  connection jsonb;
BEGIN
  BEGIN
    PERFORM public.record_brilstash_release_request(installation, requested);
    RAISE EXCEPTION 'release was recorded without durable saved-connection verification';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM public.approve_brilstash_candidate(installation, (requested->>'generationId')::uuid,
    requested->>'payloadDigest');
  state := public.inspect_brilstash_probe_state(installation);
  probe_id := public.record_brilstash_handoff_probe(installation, state, operator_request, feed_url);
  IF public.record_brilstash_handoff_probe(installation, state, operator_request, feed_url)
    IS DISTINCT FROM probe_id THEN RAISE EXCEPTION 'probe retry created a duplicate'; END IF;
  IF public.check_brilstash_handoff(installation, probe_id)->>'partnerIdentity' IS DISTINCT FROM 'fixture-one'
  THEN RAISE EXCEPTION 'current probe did not identify the exact partner binding'; END IF;

  proof := encode(sha256(convert_to(
    '["brilstash-page-v1","' || partner_request || '","' || (state->>'generationId')
      || '","' || (state->>'credentialId') || '","' || (state->>'payloadDigest') || '"]',
    'UTF8'
  )), 'hex');
  connection := jsonb_build_object(
    'partnerIdentity', 'fixture-one', 'url', feed_url, 'configurationRevision', 'config-r8',
    'requestId', partner_request, 'pageProof', proof,
    'evidenceReference', 'Fixture partner held-result readback', 'importsDisabled', true,
    'mode', 'held', 'runId', 'run-18', 'attemptId', 'attempt-1', 'stagedResultId', 'result-1'
  );
  BEGIN
    PERFORM public.record_brilstash_saved_connection(installation, probe_id,
      jsonb_set(connection, '{url}', '"https://wrong.example.invalid/"'));
    RAISE EXCEPTION 'incorrect saved URL was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.record_brilstash_saved_connection(installation, probe_id,
      jsonb_set(connection, '{requestId}', to_jsonb(operator_request)));
    RAISE EXCEPTION 'operator request was accepted as a partner-origin check';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.record_brilstash_saved_connection(installation, probe_id,
      jsonb_set(connection, '{pageProof}', to_jsonb(repeat('0', 64))));
    RAISE EXCEPTION 'incorrect credential or response proof was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  verification_id := public.record_brilstash_saved_connection(installation, probe_id, connection);
  IF public.record_brilstash_saved_connection(installation, probe_id, connection)
    IS DISTINCT FROM verification_id THEN RAISE EXCEPTION 'saved check retry created a duplicate'; END IF;
  saved_verification_id := public.record_brilstash_saved_connection(
    installation, probe_id,
    (connection - ARRAY['runId','attemptId','stagedResultId']) || jsonb_build_object(
      'mode', 'saved', 'requestId', saved_request,
      'pageProof', encode(sha256(convert_to(
        '["brilstash-page-v1","' || saved_request || '","' || (state->>'generationId')
          || '","' || (state->>'credentialId') || '","' || (state->>'payloadDigest') || '"]',
        'UTF8'
      )), 'hex')
    )
  );
  IF public.check_brilstash_handoff(installation, probe_id, saved_verification_id)->>'configurationRevision'
    IS DISTINCT FROM 'config-r8' THEN RAISE EXCEPTION 'enablement did not bind the verified revision'; END IF;

  BEGIN
    PERFORM public.record_brilstash_enablement_readback(
      installation, verification_id, readback_id, 'config-r8', true, false, 'held result may not enable future imports'
    );
    RAISE EXCEPTION 'held verification was accepted for recurring enablement';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF public.record_brilstash_enablement_readback(
    installation, saved_verification_id, readback_id, 'config-r8', true, false, 'observed scheduled enablement'
  ) IS DISTINCT FROM readback_id THEN RAISE EXCEPTION 'enablement readback was not recorded'; END IF;
  PERFORM set_config('fixture.saved_verification_id', saved_verification_id::text, true);
  requested := requested || jsonb_build_object('verificationId', verification_id);
  BEGIN
    PERFORM public.record_brilstash_release_request(installation,
      jsonb_set(requested, '{stagedResultId}', '"different-result"'));
    RAISE EXCEPTION 'an unverified staged result was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.rotate_brilstash_credential(installation, (state->>'credentialRevision')::bigint,
      encode(sha256(convert_to(repeat('q', 43), 'UTF8')), 'hex'), 60);
    IF public.inspect_brilstash_probe_state(installation)->>'generationId' IS DISTINCT FROM state->>'generationId'
    THEN RAISE EXCEPTION 'fixture changed payload rather than only the credential'; END IF;
    BEGIN
      PERFORM public.check_brilstash_handoff(installation, probe_id);
      RAISE EXCEPTION 'old probe was accepted after rotation';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
      PERFORM public.record_brilstash_release_request(installation, requested);
      RAISE EXCEPTION 'release was allowed after rotation';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    RAISE EXCEPTION 'rollback fixture rotation' USING ERRCODE = 'PT002';
  EXCEPTION WHEN SQLSTATE 'PT002' THEN NULL;
  END;
  PERFORM set_config('fixture.release_request', requested::text, true);
  release_id := public.record_brilstash_release_request(installation, requested);
  IF public.record_brilstash_release_request(installation, requested) IS DISTINCT FROM release_id
  THEN RAISE EXCEPTION 'same release request was duplicated'; END IF;
  BEGIN
    PERFORM public.record_brilstash_release_request(installation, jsonb_set(requested, '{attemptId}', '"attempt-2"'));
    RAISE EXCEPTION 'second attempt admitted while first is unresolved';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF public.check_brilstash_handoff(installation, probe_id, verification_id, release_id)->>'attemptId'
    IS DISTINCT FROM 'attempt-1' THEN RAISE EXCEPTION 'release check did not bind the attempt'; END IF;
  PERFORM public.record_brilstash_attempt_disposition(
    installation, release_id, 'run-18', 'attempt-1', 'awaiting_application',
    'fixture queued acknowledgement', false, false
  );
  PERFORM public.record_brilstash_attempt_disposition(
    installation, release_id, 'run-18', 'attempt-1', 'awaiting_application',
    'fixture queued acknowledgement', false, false
  );
  PERFORM set_config('fixture.release_id', release_id::text, true);
END $$;
RESET ROLE;
DO $$
BEGIN
  BEGIN
    UPDATE private.brilstash_installations SET admission = 'closed'
    WHERE id = '30000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'routine closure ignored the unresolved attempt';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM public.suspend_brilstash_installation(
    '30000000-0000-4000-8000-000000000001', 'Fixture takedown'
  );
END $$;
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM private.brilstash_installations i
    JOIN private.brilstash_suspensions s ON s.installation_id = i.id
      AND s.prior_generation_id = i.active_generation_id
    WHERE i.id = '30000000-0000-4000-8000-000000000001'
      AND i.admission = 'suspended' AND i.serving_revision = 4
      AND i.catalogue_revision = s.catalogue_revision AND s.reason = 'Fixture takedown'
  ) THEN RAISE EXCEPTION 'suspension did not revoke admission and invalidate old work'; END IF;
END $$;
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF fixture.read_brilstash_page(repeat('k', 43), 1, 100, 0)->>'status' IS DISTINCT FROM 'unavailable'
  THEN RAISE EXCEPTION 'suspended feed was still served'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  installation uuid := '30000000-0000-4000-8000-000000000001';
  release_id uuid := current_setting('fixture.release_id')::uuid;
BEGIN
  BEGIN
    PERFORM public.record_brilstash_release_request(installation, current_setting('fixture.release_request')::jsonb);
    RAISE EXCEPTION 'release was permitted after urgent suspension';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.record_brilstash_attempt_disposition(
      installation, release_id, 'run-18', 'attempt-2', 'applied', 'wrong attempt', true, true
    );
    RAISE EXCEPTION 'wrong attempt terminal evidence was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM public.record_brilstash_attempt_disposition(
    installation, release_id, 'run-18', 'attempt-1', 'partial_application',
    'partner observed a partial update', false, false
  );
  BEGIN
    PERFORM public.record_brilstash_attempt_disposition(
      installation, release_id, 'run-18', 'attempt-1', 'cancelled_without_application',
      'cancellation status only', true, true
    );
    RAISE EXCEPTION 'partial application was rewritten as cancellation';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM public.record_brilstash_attempt_disposition(
    installation, release_id, 'run-18', 'attempt-1', 'partial_application_reconciled',
    'changed listings verified off sale and remaining jobs blocked', true, true
  );
END $$;
DO $$
DECLARE tracked jsonb;
DECLARE observations jsonb;
DECLARE installation uuid := '30000000-0000-4000-8000-000000000001';
BEGIN
  PERFORM public.record_brilstash_enablement_readback(
    installation, current_setting('fixture.saved_verification_id')::uuid,
    'f1000000-0000-4000-8000-000000000002', 'config-r9', false, false, 'imports disabled after suspended configuration changed'
  );
  observations := public.inspect_brilstash_enablement(installation);
  IF observations->0->>'matchesVerifiedRevision' IS DISTINCT FROM 'false'
    OR observations->0->>'scheduledEnabled' IS DISTINCT FROM 'false'
    OR observations->1->>'matchesVerifiedRevision' IS DISTINCT FROM 'true'
    OR observations->1->>'scheduledEnabled' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'enablement history lost the original revision or current discrepancy'; END IF;
  tracked := public.inspect_brilstash_releases('30000000-0000-4000-8000-000000000001');
  IF tracked->0->>'status' IS DISTINCT FROM 'partial_application_reconciled'
    OR tracked->0->>'withdrawalRequired' IS DISTINCT FROM 'true'
    OR tracked::text LIKE '%bearer_digest%'
  THEN RAISE EXCEPTION 'operator could not inspect the reconciled attempt'; END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM private.brilstash_released_attempts a
    JOIN private.brilstash_installations i ON i.id = a.installation_id
    WHERE a.id = current_setting('fixture.release_id')::uuid AND i.admission = 'suspended'
      AND a.withdrawal_required AND a.status = 'partial_application_reconciled' AND a.resolved_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'application evidence cleared suspension or lost attempt history'; END IF;
END $$;
