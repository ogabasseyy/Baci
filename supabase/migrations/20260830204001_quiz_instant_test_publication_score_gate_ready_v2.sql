-- Open test publication only after the preceding serialized score repair has
-- committed. Failed deadline attempts remain retryable after this gate opens.

BEGIN;

UPDATE private.quiz_test_publication_control_v2
SET score_repair_ready = true
WHERE singleton;

COMMIT;
