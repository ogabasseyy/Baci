# Stage 1 PostgreSQL SQL Benchmark & Proof Results

- Postgres: `17.11 (Homebrew)` (`synchronous_commit = on`, 12 cores, 96 GB RAM)
- `supabase/tests/quiz_stage1_prototype.sql`: **PASSED**

## 1. Normalized-Email Index Comparison (`EXPLAIN (ANALYZE, BUFFERS)`)

| Customers | Event Attempts | Check-In Lookup (No Index) | Check-In Lookup (With `idx_customers_merchant_quiz_normalized_email`) | Legacy Trigger Query (No Index / With `idx_customers_merchant_quiz_normalized_email_all`) |
|---:|---:|---|---|---|
| 50,000 | 1,000 | Seq Scan: 60.33 ms (940 bufs) | Index Scan (idx_customers_merchant_quiz_normalized_email_all): 0.157 ms (4 bufs) | 57.56 ms (Index Scan) / 0.048 ms (Index Scan) |
| 50,000 | 10,000 | Seq Scan: 145.21 ms (940 bufs) | Index Scan (idx_customers_merchant_quiz_normalized_email_all): 0.042 ms (4 bufs) | 176.90 ms (Index Scan) / 0.045 ms (Index Scan) |
| 50,000 | 50,000 | Seq Scan: 59.34 ms (940 bufs) | Index Scan (idx_customers_merchant_quiz_normalized_email_all): 0.040 ms (4 bufs) | 57.74 ms (Seq Scan) / 0.058 ms (Index Scan) |

## 2. Legacy Per-Row Triggers vs Edge Staging + Streaming Pre-Score + Fast Close Finalize

| Workload | Attempts | Staged Answers | Ingest Time | Pre-Score (95% Pre-Close) | Post-Close Finalize (5% Tail + Attempts + Results) | Post-Publish Backfill (10k Chunk) | Total WAL | Trigger Calls (Cap / Score / Live) | Checkout p99 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Legacy per-row triggers | 500 | 5,000 | 680.2 ms (735.1 att/s) | inline | inline | inline | 6.31 MB (13243.1 B/att) | 500 / 5000 / 6000 | n/a |
| Edge 100k (200 rooms) | 100,000 | 985,000 | 3577.8 ms (27950.5 att/s) | 10844.9 ms (95,000 att) | 3962.4 ms (25237.2 att/s) | 3656.9 ms (26952.2 ans/s) | 418.70 MB | 0 / 0 / 0 | 10.69 ms (0 err) |
| Edge 1M (2,000 rooms) | 1,000,000 | 9,850,000 | 37828.3 ms (26435.2 att/s) | 120087.9 ms (950,000 att) | 41219 ms (24260.6 att/s) | 3743.5 ms (26320.2 ans/s) | 4583.01 MB | 0 / 0 / 0 | 19.176 ms (0 err) |
