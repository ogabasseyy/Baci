\set ON_ERROR_STOP on
\ir primary-wallet-paid-interest-production-setup.integration.sql
\ir primary-wallet-paid-interest-production-environment.integration.sql
\ir primary-wallet-paid-interest-production-earnings.integration.sql
\ir primary-wallet-paid-interest-production-reversals.integration.sql
\ir primary-wallet-paid-interest-production-access.integration.sql
SELECT 'PRIMARY production paid-interest, capacity, earnings and notification regressions passed' AS result;
