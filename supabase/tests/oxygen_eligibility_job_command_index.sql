DO $test$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index AS i
    JOIN pg_attribute AS a
      ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
    WHERE i.indrelid = 'oxygen_private.eligibility_jobs'::regclass
      AND i.indexrelid = to_regclass('oxygen_private.oxygen_eligibility_jobs_command_id_idx')
      AND i.indisvalid
      AND i.indpred IS NULL
      AND a.attname = 'command_id'
  ) THEN
    RAISE EXCEPTION 'Missing indexed lookup for the eligibility job command foreign key';
  END IF;
END
$test$;
