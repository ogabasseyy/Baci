-- Include-only helper for manual_order_documents_redemption.sql (no BEGIN/ROLLBACK): the suite loads it with \ir.
-- The helper is called after SET ROLE, so it needs an explicit GRANT (new functions are
-- not executable by other roles by default).

CREATE OR REPLACE FUNCTION pg_temp.assert_true(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; END $$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_true(boolean, text) TO PUBLIC; -- called after SET ROLE
