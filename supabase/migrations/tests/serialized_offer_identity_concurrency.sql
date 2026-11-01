-- Product and anchor identity changes must serialize with a new assignment,
-- while ordinary stock-sync updates remain compatible with its key-share locks.
CREATE EXTENSION IF NOT EXISTS dblink;
\getenv test_db CODEX_OFFER_TEST_DB
\getenv test_host PGHOST
\getenv test_port PGPORT
\getenv test_user PGUSER
\getenv test_password PGPASSWORD
SELECT set_config('test.offer_conn', format('host=%L port=%L user=%L dbname=%L password=%L', :'test_host', :'test_port', :'test_user', :'test_db', :'test_password'), false) AS ignored \gset
SELECT set_config('test.identity_mode','product',false) AS ignored \gset
\ir serialized_offer_identity_race.inc.sql
SELECT set_config('test.identity_mode','anchor',false) AS ignored \gset
\ir serialized_offer_identity_race.inc.sql
