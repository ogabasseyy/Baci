\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout=120000;
\ir redvault-public-product-full-schema-seed.sql
\ir redvault-private-pilot-full-schema-setup.sql
\ir redvault-public-product-prepublic-history.sql
\ir redvault-public-product-full-schema.sql
\ir redvault-public-product-full-schema-history.sql
SET LOCAL ROLE postgres;
\ir redvault-public-product-supervised-refund.sql
RESET ROLE;
\ir redvault-public-product-full-schema-history.sql
ROLLBACK;
\echo 'Full-schema REDVAULT public product regression passed; all fixtures rolled back.'
