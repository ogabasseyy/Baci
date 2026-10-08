-- Run only in an empty disposable PostgreSQL database, using psql from this
-- directory. Backdate-edit coverage for the real production wrapper chain;
-- cases live in the included part files so each file stays focused.
\set ON_ERROR_STOP on
\ir admin_order_date_edit.fixtures.sql
\ir admin_order_date_edit.date_cases.sql
\ir admin_order_date_edit.guard_cases.sql
