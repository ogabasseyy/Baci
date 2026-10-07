\set ON_ERROR_STOP on
\ir customer_savings_canonical_isolation.setup.sql
\ir customer_savings_canonical_isolation.allocations.sql
\ir customer_savings_canonical_isolation.direct.sql
\ir customer_savings_canonical_isolation.shape.sql
\ir customer_savings_canonical_isolation.tenant.sql
\ir customer_savings_canonical_isolation.boundaries.sql
ROLLBACK;
\echo 'PASS schema isolation: disabled creation, preserved null provenance, legacy allocation/RLS/direct-SQL denial and legacy positive control'
