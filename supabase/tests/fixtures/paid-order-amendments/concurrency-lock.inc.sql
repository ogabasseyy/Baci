-- Run only against the disposable replay database. The two backends need
-- committed fixtures to see each other's writes.
\set ON_ERROR_STOP on
\if :{?dblink_password}
\else
\set dblink_password postgres
\endif
SELECT set_config('baci.amendment_test_dblink_password', :'dblink_password', false) IS NOT NULL;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
SET search_path TO pg_catalog, public, extensions;

CREATE FUNCTION pg_temp.amendment_run_race(
  a_actor text, a_sql text, b_actor text, b_sql text, expected_error text,
  paused_payment_order uuid DEFAULT NULL, third_sql text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  a_pid integer;
  b_pid integer;
  c_pid integer;
  deadline timestamptz := clock_timestamp() + interval '5 seconds';
  conn text := format('dbname=%L user=%L host=%L port=%s password=%L',
    current_database(),current_user,inet_server_addr(),inet_server_port(),
    current_setting('baci.amendment_test_dblink_password'));
BEGIN
  PERFORM dblink_connect('pa',conn);
  PERFORM dblink_connect('pb',conn);
  SELECT pid INTO a_pid FROM dblink('pa','SELECT pg_backend_pid()') AS t(pid integer);
  SELECT pid INTO b_pid FROM dblink('pb','SELECT pg_backend_pid()') AS t(pid integer);
  PERFORM dblink_exec('pa','BEGIN');
  PERFORM dblink_exec('pa',format('SET request.jwt.claim.sub = %L',COALESCE(a_actor,'')));
  PERFORM dblink_exec('pa',format('SET request.jwt.claim.role = %L',CASE WHEN a_actor IS NULL THEN 'service_role' ELSE 'authenticated' END));
  IF paused_payment_order IS NOT NULL THEN
    PERFORM locked FROM dblink('pa',format(
      'SELECT pg_advisory_xact_lock(hashtextextended(%L, 0))::text',
      'baci_order_payment:' || paused_payment_order
    )) AS t(locked text);
  ELSIF a_sql LIKE 'UPDATE %' THEN
    PERFORM dblink_exec('pa',a_sql);
  ELSE
    PERFORM result FROM dblink('pa',a_sql) AS t(result text);
  END IF;
  PERFORM dblink_exec('pb',format('SET request.jwt.claim.sub = %L',COALESCE(b_actor,'')));
  PERFORM dblink_exec('pb',format('SET request.jwt.claim.role = %L',CASE WHEN b_actor IS NULL THEN 'service_role' ELSE 'authenticated' END));
  PERFORM dblink_send_query('pb',b_sql);
  IF third_sql IS NOT NULL THEN
    PERFORM dblink_connect('pc',conn);
    SELECT pid INTO c_pid FROM dblink('pc','SELECT pg_backend_pid()') AS t(pid integer);
    PERFORM dblink_exec('pc',format('SET request.jwt.claim.sub = %L',COALESCE(b_actor,'')));
    PERFORM dblink_exec('pc',format('SET request.jwt.claim.role = %L',CASE WHEN b_actor IS NULL THEN 'service_role' ELSE 'authenticated' END));
    PERFORM dblink_send_query('pc',third_sql);
  END IF;
  LOOP
    EXIT WHEN a_pid = ANY(pg_blocking_pids(b_pid))
      AND (c_pid IS NULL OR a_pid = ANY(pg_blocking_pids(c_pid)) OR b_pid = ANY(pg_blocking_pids(c_pid)));
    IF clock_timestamp() >= deadline THEN
      RAISE EXCEPTION 'second operation never waited for the first';
    END IF;
    PERFORM pg_sleep(0.01);
  END LOOP;
  IF paused_payment_order IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.transactions
        WHERE order_id = paused_payment_order AND status = 'pending') THEN
      RAISE EXCEPTION 'confirmation did not wait before pending payment insertion';
    END IF;
    PERFORM result FROM dblink('pa',a_sql) AS t(result text);
  END IF;
  PERFORM dblink_exec('pa','COMMIT');
  PERFORM result FROM dblink_get_result('pb',false) AS t(result text);
  IF (expected_error IS NULL AND dblink_error_message('pb') <> 'OK')
    OR (expected_error IS NOT NULL AND position(expected_error IN dblink_error_message('pb')) = 0) THEN
    RAISE EXCEPTION 'expected %, got %',expected_error,dblink_error_message('pb');
  END IF;
  PERFORM dblink_disconnect('pb');
  IF third_sql IS NOT NULL THEN
    PERFORM result FROM dblink_get_result('pc',false) AS t(result text);
    IF position(expected_error IN dblink_error_message('pc')) = 0 THEN
      RAISE EXCEPTION 'third operation: expected %, got %',expected_error,dblink_error_message('pc');
    END IF;
    PERFORM dblink_disconnect('pc');
  END IF;
  PERFORM dblink_disconnect('pa');
EXCEPTION WHEN OTHERS THEN
  IF 'pc' = ANY(COALESCE(dblink_get_connections(),'{}'::text[])) THEN
    PERFORM dblink_cancel_query('pc');
    PERFORM dblink_disconnect('pc');
  END IF;
  IF 'pb' = ANY(COALESCE(dblink_get_connections(),'{}'::text[])) THEN
    PERFORM dblink_cancel_query('pb');
    PERFORM dblink_disconnect('pb');
  END IF;
  IF 'pa' = ANY(COALESCE(dblink_get_connections(),'{}'::text[])) THEN
    PERFORM dblink_disconnect('pa');
  END IF;
  RAISE;
END;
$$;
