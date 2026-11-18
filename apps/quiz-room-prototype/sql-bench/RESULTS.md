# Stage 1 PostgreSQL SQL Benchmark & Proof Results

- Postgres: `17.11 (Homebrew)` (`synchronous_commit = on`, 12 cores, 96 GB RAM)
- `supabase/tests/quiz_stage1_prototype.sql`: **PASSED**

## 1. Normalized-Email Index Comparison (`EXPLAIN (ANALYZE, BUFFERS)`)

| Customers | Event Attempts | Check-In Lookup (No Index) | Check-In Lookup (With `idx_customers_merchant_quiz_normalized_email`) | Legacy Trigger Query (No Index / With Partial Index) |
|---:|---:|---|---|---|
| 50,000 | 1,000 | Seq Scan: 101.84 ms (940 bufs) | Index Scan (idx_customers_merchant_quiz_normalized_email): 0.036 ms (4 bufs) | 64.22 ms / 60.82 ms |
| 50,000 | 10,000 | Seq Scan: 60.80 ms (940 bufs) | Index Scan (idx_customers_merchant_quiz_normalized_email): 0.041 ms (4 bufs) | 60.95 ms / 60.23 ms |
| 50,000 | 50,000 | Seq Scan: 60.50 ms (940 bufs) | Index Scan (idx_customers_merchant_quiz_normalized_email): 0.043 ms (4 bufs) | 59.11 ms / 59.71 ms |

## 2. Legacy Per-Row Triggers vs Edge Staging + Set-Wise Scoring

| Workload | Attempts | Answers | Ingest Time | Scoring Time | Total WAL | `quiz_enforce_identity_attempt_cap` Calls | `accumulate_quiz_attempt_score_v2` Calls | `refresh_quiz_live_standing_v2` Calls | Checkout p99 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Legacy per-row triggers | 500 | 5,000 | 30268.2 ms (16.5 att/s) | inline | 6.28 MB (13167.7 B/att) | 500 | 5000 | 6000 | n/a |
| Edge 100k (200 rooms) | 100,000 | 985,000 | 3232.5 ms (30936.2 att/s) | 37990.4 ms (2632.2 att/s, 25927.6 ans/s) | 1429.11 MB | 0 | 0 | 0 | 11.115 ms (0 err) |
| Edge 1M (2,000 rooms) | 1,000,000 | 9,850,000 | 34228.5 ms (29215.4 att/s) | 346506.4 ms (2885.9 att/s, 28426.6 ans/s) | 17180.19 MB | 0 | 0 | 0 | 12.001 ms (0 err) |
