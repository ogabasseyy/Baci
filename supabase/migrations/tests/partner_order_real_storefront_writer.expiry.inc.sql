-- Run after the order writer checks within the same transaction.
DO $$
<<fixture>>
DECLARE
  merchant_id constant uuid := '7a100000-0000-4000-8000-000000000001';
  quote_id constant uuid := '7a100000-0000-4000-8000-000000000031';
  submission_id constant uuid := '7a100000-0000-4000-8000-000000000041';
  connection_id constant text := 'partner-real-writer';
  expired_submissions bigint;
  expected_job record;
  existing_job_id bigint;
BEGIN
  UPDATE private.partner_delivery_quotes
  SET created_at = now() - interval '10 days', expires_at = now() - interval '9 days'
  WHERE id = fixture.quote_id;

  INSERT INTO private.partner_delivery_quotes (id, merchant_id, connection_id, created_at, expires_at, snapshot)
  VALUES
    ('7a100000-0000-4000-8000-000000000051', merchant_id, connection_id,
      now() - interval '10 days', now() - interval '9 days', '{}'),
    ('7a100000-0000-4000-8000-000000000052', merchant_id, connection_id,
      now() - interval '2 days', now() - interval '1 day', '{}'),
    ('7a100000-0000-4000-8000-000000000053', merchant_id, connection_id,
      now(), now() + interval '10 minutes', '{}'),
    ('7a100000-0000-4000-8000-000000000054', merchant_id, connection_id,
      now() - interval '10 days', now() - interval '9 days', '{}');

  INSERT INTO private.partner_order_submissions (
    merchant_id, connection_id, quote_id, partner_order_id, idempotency_hash, submission, received_at
  ) VALUES (
    merchant_id, connection_id, '7a100000-0000-4000-8000-000000000054',
    'abandoned-payment-fixture', repeat('a', 64), '{}', now() - interval '8 days'
  );
  expired_submissions := private.expire_unverified_partner_submissions();
  IF expired_submissions <> 1
     OR EXISTS (SELECT 1 FROM private.partner_delivery_quotes WHERE id = '7a100000-0000-4000-8000-000000000054')
     OR NOT EXISTS (
       SELECT 1 FROM private.partner_payment_captures AS c WHERE c.submission_id = fixture.submission_id
     ) THEN
    RAISE EXCEPTION 'submission expiry lost verified evidence or retained the abandoned quote (deleted %)', expired_submissions;
  END IF;

  IF private.expire_unclaimed_partner_quotes() <> 1 THEN
    RAISE EXCEPTION 'quote expiry reported an unexpected deletion count';
  END IF;
  IF EXISTS (SELECT 1 FROM private.partner_delivery_quotes WHERE id = '7a100000-0000-4000-8000-000000000051')
     OR (SELECT count(*) FROM private.partner_delivery_quotes WHERE id IN (
       fixture.quote_id, '7a100000-0000-4000-8000-000000000052', '7a100000-0000-4000-8000-000000000053'
     )) <> 3 THEN
    RAISE EXCEPTION 'quote expiry failed to remove abandoned data or keep protected quotes';
  END IF;
  IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    FOR expected_job IN SELECT * FROM (VALUES
      ('partner-unclaimed-quote-expiry', '22 * * * *', 'SELECT private.expire_unclaimed_partner_quotes();'),
      ('partner-unverified-submission-expiry', '37 * * * *', 'SELECT private.expire_unverified_partner_submissions();')
    ) AS expected(job_name, job_schedule, job_command)
    LOOP
      SELECT jobid INTO STRICT existing_job_id FROM cron.job
      WHERE jobname = expected_job.job_name AND database = current_database();
      IF NOT EXISTS (
        SELECT 1 FROM cron.job WHERE jobid = existing_job_id AND active
          AND username = current_user AND schedule = expected_job.job_schedule
          AND command = expected_job.job_command
      ) OR cron.schedule(expected_job.job_name, expected_job.job_schedule, expected_job.job_command)
        IS DISTINCT FROM existing_job_id THEN
        RAISE EXCEPTION 'partner expiry job is missing, duplicated or not reusable: %', expected_job.job_name;
      END IF;
    END LOOP;
  END IF;
END;
$$;
