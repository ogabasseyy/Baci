INSERT INTO piggyvest_savings_exit_execution.evidence_scopes
  VALUES('40000000-0000-4000-8000-000000000001','synthetic-business','piggyvest_exit_evidence_writer',true);
GRANT USAGE ON SCHEMA piggyvest_savings_exit_execution, savings_exit_execution_test, goal_policy_test TO piggyvest_exit_evidence_writer;
GRANT EXECUTE ON FUNCTION piggyvest_savings_exit_execution.record_evidence(uuid,jsonb) TO piggyvest_exit_evidence_writer;
GRANT EXECUTE ON FUNCTION piggyvest_savings_exit_execution.consume_evidence(uuid,uuid,uuid,uuid,text,uuid,uuid,text)
  TO piggyvest_staging_policy_writer;
CREATE TRIGGER synthetic_last_write_failure BEFORE INSERT ON piggyvest_savings_exit_execution.accounting_receipts
  FOR EACH ROW EXECUTE FUNCTION savings_exit_execution_test.fail_last_write();

SET SESSION AUTHORIZATION piggyvest_staging_policy_writer;
SELECT savings_exit_execution_test.assert(savings_exit_execution_test.begin_exit(212,'purchase')->>'state'='submit','purchase begins');
SELECT savings_exit_execution_test.assert(savings_exit_execution_test.begin_exit(213,'cancellation')->>'state'='submit','cancel begins');
SELECT savings_exit_execution_test.assert(savings_exit_execution_test.consume(212,'purchase')->>'state'='pending','no receipt refuses');
SELECT savings_exit_execution_test.reject($q$SELECT savings_exit_execution_test.store(212)$q$,'42501');
RESET SESSION AUTHORIZATION;

BEGIN;
SET SESSION AUTHORIZATION piggyvest_exit_evidence_writer;
SELECT savings_exit_execution_test.assert(savings_exit_execution_test.store(212)->>'state'='stored','uncommitted receipt staged');
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION piggyvest_staging_policy_writer;
SELECT savings_exit_execution_test.assert(savings_exit_execution_test.consume(212,'purchase')->>'state'='pending','same transaction attestation cannot finalize');
RESET SESSION AUTHORIZATION;
ROLLBACK;
