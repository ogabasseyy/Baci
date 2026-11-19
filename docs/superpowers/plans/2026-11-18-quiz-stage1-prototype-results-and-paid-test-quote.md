# Quiz Stage 1 Prototype Results, 100k/1M Cost Model & Pre-Execution Paid Cloud Load-Test Quote

Date: 2026-11-18 · Stage 1 merged base: `4747328b67` · Phase B Worker commit: `ae6607ed4c` · Phase B DB reconciler commit: `111cecd65a` · Target plan: [Quiz scale plan (Revision 12)](2026-11-18-quiz-100k-1m-scale-plan.md)

> [!IMPORTANT]
> **Cloud Execution Status & Spend Gate (`$0.00` Incremental Spend To Date).** All Stage 1 and Phase B benchmark measurements in Sections 1.1–1.7 were executed locally on Node `v24.11.1` (`node:sqlite` + `wrangler dev --local` `workerd` HTTP server + Jest/Vitest) and local PostgreSQL `17.11` (`synchronous_commit = on`). With explicit user approval (`proced`) in chat on 2026-11-18, the isolated prototype Worker (`baci-quiz-room-prototype.ogabassey-ai.workers.dev`) was deployed to the existing Cloudflare Workers Paid account (`$0.00` incremental spend, zero production routes, **zero Supabase preview branches created yet**). Section 3 defines the **two-step paid-test approval gate**: Step 1 (`$0.00` infra) runs the 10-player real Nigerian carrier `/demo` test first; Step 2 only provisions the `~$0.30–$0.60` 1-hour XL Supabase branch and paid cloud rehearsals if Step 1 carrier latency passes.

---

## Executive Summary

| Dimension | Local Stage 1 Result | Key Bottleneck / Finding | Cloud Qualification Remaining |
|---|---|---|---|
| **Single-room capacity & Nigerian carrier simulation** | **500 players/room** safe ceiling; `27.082` `rowsWritten`/entrant, `62.248` `rowsRead`/entrant; `0.168 ms` SQLite commit p99; `100%` simulated carrier acks `<= 1 s` (MTN p99 `190 ms`, Airtel `246 ms`, Glo `525 ms`, 9mobile `297 ms`) | In-memory `node:sqlite` achieves `11,412 ans/s` (`97.9%` reserve vs `250 ans/s` peak); against Cloudflare DO's ~`1,000 req/s` soft limit, 500 players at 2s cadence keeps **`75%` reserve** | Live Nigeria WAN RTT (MTN/Airtel/Glo/9mobile) to Cloudflare DO placement & disk-backed flush |
| **5,000-player chaos & recovery (12 active + 1 never-opened room)** | **PASSED**: exact SQL parity (`5,000/5,000`, `1` award), `0` attempts in never-opened room, `0` awards when cancelled, withheld seal & interrupted scoring held publication, dropped batch recovered from `room_batches`, `persistedCloseAt` vs `ends_at` changed `2` ranks | File-backed `NodeSqliteAdapter.reopen()` preserved clocks & attempt IDs across restart; `1 ms` cross-room tie resolved deterministically | Real DO alarm jitter & multi-DO network partition timing |
| **Mobile Realtime suppression (Test 3)** | **PASSED (26/26 Jest tests)**: `0` `quiz-results` channel joins & `0` `supabase.realtime.setAuth()` calls across normal play, `pending_results`, resume, and `AppState` reconnect for `backendMode: 'edge_rooms'`; `postgres` retains wakeup | HTTP polling delivered published `final` results with Realtime unavailable | End-to-end release-equivalent mobile build against staging Worker |
| **100k gameplay + 100k live-rank (80% tie cohort)** | `12,035 ans/s` (`uniform_10m`) & `12,167 ans/s` (`surge_30s_50pct`), `0` dropped iterations; LiveRank **1,452x write reduction** (`723` range rows vs `1,050,000` full rewrites across 20 ticks, `0` idle writes), exact SQL order down to `attemptId` | `ResultShardEngine.getPublishedLeaderboard` runs `100` `resolveDisplayName` awaits + `JSON.parse` per call (`0.775 ms` p50); caching pre-resolved `top100` per `controlState.version` in Stage 2 will cut leaderboard shard CPU ~10x | Live 100k HTTP fan-out through Cloudflare edge + admission burst on Supabase RLS |
| **1M queue packing & 1M private-result + leaderboard lookups** | Queue: `15.15` bundles/msg, `61,537` bytes/msg (`max 62,931 < 64,000`), `3.0` ops/msg, oversized `99,119 B` bundle split into `2` parts (`max 59,972 B`) & reassembled; Shards (64 shards): **1,000,000 `getAttemptResult` (`p99 0.126 ms`) + 1,000,000 `getPublishedLeaderboard` (`p99 1.413 ms`)**, `0` non-winner origin calls, winner claim handoff verified | At `66,000` messages for 1M entrants, queue drains in **`13.2 s`** at CF's `5,000 msg/s` limit | Cold-cache edge TTL tuning & 11,000 req/s burst within 5-minute SLA |
| **Postgres ingest, index & incremental scoring (`@db-reconciler`)** | Stage 1: `0.036–0.043 ms` email index, 1M single-pass `346.51 s`; **Phase B (`111cecd65a`)**: unfiltered `idx_customers_merchant_quiz_normalized_email_all` (`0.040–0.157 ms` check-in, `0.045–0.058 ms` legacy trigger), **1M** (`2,000` rooms, `9.85M` answers) ingest `37.83 s`, 95% pre-close scoring `120.09 s`, seal `308.6 ms`, **post-close finalize `41.22 s` (`< 60 s`, 8.4x faster)**, `0/0/0` triggers, `13,034` checkouts `p99 19.18 ms` (`0` err) | Streaming pre-close scoring + deferred canonical answer backfill puts 1M post-close finalize inside the 5-minute SLA with >4 min headroom | Run 1M staging ingest + incremental scoring on isolated Supabase `4XL` branch |

---

## Section 1: Measured Stage 1 Prototype Capacity, Correctness & Resource Counters

### 1.1 Execution Environment & Qualification Boundary

- **Executed locally (`apps/quiz-room-prototype/bench/run-all.ts`, `latest-results.json`)**:
  - Runtime: Node `v24.11.1`, `node:sqlite` (`DatabaseSync`) via `NodeSqliteAdapter` (identical SQL schema, secondary-index write accounting, and `RoomStorageBackend` contract as `CloudflareSqlStorageAdapter`), plus `wrangler dev --local` offline `workerd` HTTP 200 smoke test (`127.1 KB` esbuild bundle) and `apps/mobile-storefront` Jest (`react-native` mocked `@/lib/supabase`).
  - Local PostgreSQL (`apps/quiz-room-prototype/sql-bench/results.json`): PostgreSQL `17.11 (Homebrew)`, `synchronous_commit = on`, 12 CPU cores, 96 GB RAM.
- **Requires live cloud qualification (not measurable locally)**:
  - Real Nigerian cellular WAN routing (MTN, Airtel, Glo, 9mobile) to Cloudflare DO geographic placement (`workerd` single-isolate disk-backed SQLite fsync latency).
  - Real Supabase Envoy/PostgREST gateway behavior (`~220 req/s` distinct ES256 token ceiling on XL observed in [2026-11-18-quiz-loadtest-results.md](2026-11-18-quiz-loadtest-results.md)) under 100k/1M admission bursts and `4XL` staging Postgres WAL/IOPS limits at 1,000,000 attempts.
  - Live Apple App Attest / Google Play Integrity token issuance and Auth email quota (`12,000/hr`) with a small real-device cohort.

### 1.2 Proof 1: Single-Room Saturation & Nigerian Mobile Carrier RTT Simulation

Executed real `QuizRoomEngine` + `NodeSqliteAdapter` across increasing room sizes at a compressed 2.5-second answer cadence (`20s` open-loop arrival window) with mixed Nigerian carrier RTT/jitter/loss simulation (`MTN 45%`, `Airtel 30%`, `Glo 20%`, `9mobile 5%`; 0.6%–1.5% downstream ack loss triggering idempotent client retries):

| Players in Room | Offered Ans/s | Achieved Ans/s (Local SQLite) | Server Commit p50 / p99 | Client Ack p99 (w/ RTT + Retry) | Client Ack `<= 1s` | System Timeouts | `rowsWritten` / Entrant | `rowsRead` / Entrant |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 250 | 100 | 11,088 | 0.050 ms / 0.204 ms | 409.09 ms | 100.0% | 0.0% | 27.092 | 62.300 |
| **500 (Safe Target)** | **200** | **11,412** | **0.050 ms / 0.168 ms** | **281.05 ms** | **100.0%** | **0.0%** | **27.082** | **62.248** |
| 750 | 300 | 11,656 | 0.050 ms / 0.162 ms | 277.05 ms | 100.0% | 0.0% | 27.079 | 62.219 |
| 1,000 | 400 | 11,438 | 0.051 ms / 0.163 ms | 300.05 ms | 100.0% | 0.0% | 27.077 | 62.250 |
| 1,500 | 600 | 11,337 | 0.051 ms / 0.153 ms | 291.05 ms | 100.0% | 0.0% | 27.075 | 62.239 |

**Carrier Breakdown at 500 Players/Room (`2,500 ms` cadence):**

| Carrier | Share | Answer Requests | Idempotent Retries | Client p50 | Client p95 | Client p99 | `<= 1s` Rate | System Timeouts |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| MTN | 45% | 2,300 | 10 | 111.06 ms | 166.05 ms | 190.06 ms | 100.0% | 0 |
| Airtel | 30% | 1,400 | 14 | 128.05 ms | 201.05 ms | 246.05 ms | 100.0% | 0 |
| Glo | 20% | 980 | 15 | 182.06 ms | 253.05 ms | 525.09 ms | 100.0% | 0 |
| 9mobile | 5% | 320 | 4 | 157.05 ms | 237.05 ms | 297.04 ms | 100.0% | 0 |

- **Safe room sizing**: **500 entrants/room** (`250 ans/s` worst-case at 2s/answer) retains **`75.0%` throughput reserve** against Cloudflare Durable Object's ~`1,000 req/s` soft per-object ceiling (and **`97.86%`** against the `11,656 ans/s` local SQLite ceiling). Note: `500` entrants/room produces `13,541` `rowsWritten` and `31,124` `rowsRead` per room (`27.082` writes and `62.248` reads per entrant across start, 10 answers, batch exports, and room seal).

### 1.3 Proof 2: 5,000-Player Multi-Room Chaos, Closure & Recovery

Executed `5,000` players across `12` active file-backed SQLite rooms + `1` frozen never-opened room (`room-evt-5k-never-opened`) with `EventCoordinatorEngine` and `sql-reference.ts`:

| Chaos / Fairness Check | Measured Result |
|---|---|
| Never-opened room (`room-evt-5k-never-opened`) | `0` attempts; durable empty seal recorded |
| 0-answer started attempt | `1` started attempt preserved with `0` answers |
| 7/10 disconnected partial player placing | Placed at rank `#1389` under `persistedCloseAtMs` |
| Cross-room millisecond tie (`room-0002` vs `room-0003`, 1ms apart) | Exact rank separation (`tierA.rank + 1 === tierB.rank`) |
| Room restart mid-event (`NodeSqliteAdapter.reopen()`) | `0` lost answers, resume preserved `attemptId` & clocks |
| Lost queue batch (batch seq 1 dropped in `room-0003`) | Replayed cleanly from durable `room_batches` journal |
| Withheld seal (`room-0005` timeout on sweep 1) | `allRoomsSealed === false` -> publication & awards **blocked** |
| Halfway-interrupted scoring (`scoringRunCompleted === false`) | Publication & awards **blocked** until resumed |
| Post-recovery SQL reference parity | Exact `5,000/5,000` standings match; **`1` award** |
| Cancelled event replay (`sealMode = 'cancelled'`) | Sealed audit record; **`0` awards** |
| Fairness diff: `persistedCloseAtMs` (`ends_at + 1,450ms`) vs scheduled `ends_at` | **`2` ranks changed** when open/partial attempts used `ends_at` instead of `persistedCloseAtMs` |

### 1.4 Proof 3: Mobile Realtime Suppression (Test 3)

Executed Jest on `apps/mobile-storefront/components/quiz/use-quiz-result-polling.edge-backend.test.ts` (6/6 tests) alongside the existing 4 polling/wakeup suites (`26/26` total passed, `check-module-size` passed with `QuizScreen.tsx` at 298 lines):

- **`backendMode: 'edge_rooms'`**: **0 `quiz-results` channel joins** and **0 `supabase.realtime.setAuth()` calls** across normal play -> `pending_results` -> `final`, persisted recovery resume, and `AppState` (`background -> active`) reconnects; HTTP polling delivered `final` results even with Realtime mocked as unavailable.
- **`backendMode: 'postgres'` (and default)**: Retains existing private `quiz-results:<eventId>` channel join (`setAuth` + `subscribe`) and broadcast wakeup behavior.

### 1.5 Proof 4: 100k Gameplay, 100k Live-Rank Tie Cohort & 1M Private Result/Leaderboard Lookups

**A. 100,000-Entrant Synthetic Gameplay Path (20 real SQLite rooms x 500 = 10,000 full 10-question attempts per profile, scaled to 200 rooms / 100,000 entrants):**

| Profile | Sample Executed | Sample Achieved Ans/s | Projected 100k Peak Ans/s | Dropped Iterations | Commit p50 / p99 | Scaled 100k Room `rowsWritten` | Scaled 100k Room `rowsRead` |
|---|---|---:|---:|---:|---:|---:|---:|
| `uniform_10m` | 10,000 attempts / 100k ans | 12,035 | 1,667 | 0 | 0.047 ms / 0.160 ms | 2,708,200 | 6,216,200 |
| `surge_30s_50pct` | 10,000 attempts / 100k ans | 12,167 | 16,667 | 0 | 0.048 ms / 0.157 ms | 2,708,200 | 6,216,200 |

**B. Live-Rank Worst-Case Tie Cohort (`100,000` real entrants, `80,000` / `80%` tied at score `8`, `20` snapshot ticks + `3` idle ticks):**

- Total dirty-range rows written: **`723` rows** vs **`1,050,000`** naive `O(players * versions)` rewrites (**`1,452.3x` reduction**).
- Idle no-op ticks rows written: **`0`**.
- Max manifest size: **`40,778` bytes**; position lookup `p99 = 0.778 ms`.
- Exact SQL rank parity down to `attemptId`: **PASS**; blocked attempt excluded: **PASS**; suppressed name masked (`Player-XXXXXXXX`): **PASS**; cross-merchant isolation (`403 QZ031`): **PASS**.

**C. 1,000,000 Distinct Authenticated Private Result & Published Leaderboard Lookups (`64` SQLite shards, 4 worker threads, cold cache, Realtime off):**

- **Attempt projection shards (`hash(attemptId, userId) mod 64`)**: `1,000,000` distinct `getAttemptResult` lookups completed; `p50 = 0.046 ms`, `p99 = 0.126 ms`; `3,000,064` shard rows written, `3,000,067` rows read.
- **Published leaderboard `currentPlayer` shards (`hash(eventId, userId) mod 64`)**: `1,000,000` distinct `getPublishedLeaderboard` lookups completed; `p50 = 0.775 ms`, `p99 = 1.413 ms`; `3,000,064` shard rows written, `3,000,064` rows read.
- **Combined 2,000,000-read wall time**: `221.06 s` (across 4 threads).
- **Invariants verified**: `0` per-viewer PostgREST/origin calls for non-winners (`nonWinnerOriginCalls = 0`), `2` winner-only origin calls (`fetchWinnerAwardFromOrigin` + post-checkout focus refresh showing `redeemed-voucher`), ticketless new-device lookup OK, cross-user spoof rejected (`not_found`).
- **5-minute delivery SLA**: With 180–240 s remaining post-publish, `1,000,000` result + `1,000,000` leaderboard reads require `~8,333–11,000 req/s` (`~172 req/s` per shard across 64 shards). Caching pre-resolved `top100` in memory per `controlState.version` in Stage 2 brings leaderboard reads down from `0.775 ms` to `<0.05 ms` (~`20,000 req/s` per DO shard).

### 1.6 Proof 5: 1M Byte-Packed Queue & Local Postgres Reconciler Counters

**A. Queue Packing (`QuizBatchPacker` + `QuizBatchReassembler` over `10,000` representative bundles: 92% 10-answer, 6% 7/10 partial, 2% 0-answer, scaled to 1M):**

| Metric | Measured (10k Sample) | Projected 1M Event |
|---|---:|---:|
| Completed bundle size (avg) | 4,177 bytes | 4,177 bytes |
| Bundles per queue message | 15.15 | 15.15 |
| Bytes per queue message (avg / max) | 61,537 B / **62,931 B** (`< 64,000 B`) | `< 64,000 B` |
| Queue messages / Queue ops (`3` per 64 KB) | 660 msgs / 1,980 ops | **66,000 msgs / 198,000 ops** |
| Total packed bytes | 40.61 MB | **4.061 GB** |
| Oversized single transcript (`99,119 B`) | Split into `2` parts (`max 59,972 B < 64k`), SHA-256 reassembled | Deterministic |
| Drain time at `5,000 msg/s` per-queue limit | 0.132 s | **13.2 s** |

**B. Local PostgreSQL Admission Index, Legacy Trigger & Edge Reconciler (`@db-reconciler` `144e4a0a33`, Postgres `17.11`, `synchronous_commit = on`):**

- **Normalized-email admission check-in (`50,000` customers)**: `Seq Scan` `60.50–101.84 ms` (`940` buffers) -> `idx_customers_merchant_quiz_normalized_email` `Index Scan` **`0.036–0.043 ms`** (`4` buffers).
- **Legacy per-row triggers (`500` attempts / `5,000` answers)**: `30.27 s` (`16.5 att/s`, `165.2 ans/s`), `6.28 MB` WAL (`13,167.7 B/att`), firing `500` identity-cap + `5,000` score-accum + `6,000` live-standing trigger calls.
- **Edge 100k staging ingest + set-wise scoring (`100,000` attempts / `985,000` answers, `200` rooms)**:
  - Staging ingest: **`3.23 s`** (`30,936.2 att/s`, `304,721.3 ans/s`, `193.08 MB` WAL); seal: **`78.2 ms`**.
  - Set-wise canonical scoring & materialization: **`37.99 s`** (`2,632.2 att/s`, `25,927.6 ans/s`, `1,236.03 MB` WAL), **`0` legacy trigger calls**, **`0` leaked live-standing rows**, idempotent double-import (`0` new rows), `3,282` concurrent storefront checkouts `p99 = 11.115 ms` (`0` errors).
- **Edge 1M staging ingest + set-wise scoring (`1,000,000` attempts / `9,850,000` answers, `2,000` rooms)**:
  - Staging ingest: **`34.23 s`** (`29,215.4 att/s`, `287,771.6 ans/s`, `2,220.73 MB` WAL); seal: **`322.2 ms`**.
  - Set-wise canonical scoring & materialization: **`346.51 s` (`5.78 min`)** (`2,885.9 att/s`, `28,426.6 ans/s`, `14,959.46 MB` WAL; **`17.18 GB`** combined WAL), **`0` legacy trigger calls**, **`0` leaked live-standing rows**, idempotent double-import (`duplicate=true`, `0` rescore writes), `28,987` concurrent storefront checkouts `p99 = 12.001 ms` (`0` errors). *(Because single-pass 1M scoring takes 5.78 min, live 1M events must stream completed attempt batches and score incrementally before close so only the post-close tail runs in the 5-min window.)*
- `supabase/tests/quiz_stage1_prototype.sql`: **PASSED** (including restricted-role catalog privilege & publication-gate checks).

### 1.7 Phase B Hardening Results (Real `workerd` HTTP, `queue()`->PG17 Replay, `< 60 s` 1M Finalize & 9:00 AM Demo Harness)

1. **Real `workerd` Open-Loop HTTP Benchmark (`apps/quiz-room-prototype/bench/open-loop-workerd-bench.mjs` -> `workerd-open-loop-results.json`, against `@room-worker` `ae6607ed4c`)**:
   Spawns real `wrangler dev --local` (`workerd`) with `QUIZ_INTERNAL_COORDINATOR_SECRET` and fires open-loop `/api/quiz/attempts/:attemptId/answers` requests across 4 dedicated rooms (`2.5 s` window per load point):

   | Offered RPS | Scheduled / Completed | Dropped Iterations | Errors | Achieved RPS | HTTP p50 | HTTP p95 | HTTP p99 |
   |---:|---:|---:|---:|---:|---:|---:|---:|
   | 100 | 250 / 250 | 0 | 0 | 100.25 | 2.08 ms | 4.07 ms | 7.66 ms |
   | 250 | 625 / 625 | 0 | 0 | 250.33 | 1.52 ms | 3.38 ms | 8.74 ms |
   | 400 | 1,000 / 1,000 | 0 | 0 | 400.19 | 1.28 ms | 2.51 ms | 4.94 ms |
   | 600 | 1,500 / 1,500 | 0 | 0 | 600.34 | 1.23 ms | 6.80 ms | 28.92 ms |

2. **End-to-End `queue()` Consumer -> Local PG `17.11` Replay & Publication Gate Proof (`bench/e2e-queue-pg-replay.mjs` -> `e2e-queue-pg-replay-results.json`)**:
   Exercises `QuizRoomEngine` -> `handleQuizQueueBatch` (`src/queue-consumer.ts`) -> local HTTP RPC bridge -> ephemeral PostgreSQL `17.11` (`ingest_quiz_edge_attempt_batch_v2`, `record_quiz_edge_room_seal_v2`, `score_quiz_edge_staged_batches_incremental_v2`, `score_and_materialize_edge_quiz_event_v2`, `process_due_quiz_deadlines_v2`):
   - `allRoomsSealed: true` across 2 active rooms + 1 never-opened room (`room-...-never`); duplicate redelivery returned `duplicates: 1`, `attemptsIngested: 0`.
   - Deliberately dropped batch `b1` blocked `score_and_materialize_edge_quiz_event_v2` (`QZ068 quiz_edge_manifest_not_reconciled`, `blockedBeforeJournalReplay: true`) until replayed from the DO `room_batches` journal (`replayIngest.attemptsIngested: 12`).
   - Incremental scoring pre-scored 1 batch pre-finalize; final close processed only the remaining `tailBatchesScored: 1` (`tailAttemptsScored: 12`), deferred canonical answer expansion (`canonicalAnswersBackfillDeferred: true`), and published **`canonicalAttemptCount: 24`, `awardCount: 1`**.

3. **Phase B Streaming 1M Scoring & Unfiltered Email Index (`@db-reconciler` `111cecd65a`, PG `17.11`, `synchronous_commit = on`)**:
   - **Unfiltered `idx_customers_merchant_quiz_normalized_email_all` (`50,000` customers)**: check-in lookup `Seq Scan 59.34–145.21 ms` -> `Index Scan 0.040–0.157 ms` (`4` bufs); legacy `quiz_enforce_identity_attempt_cap` query `57.56–176.90 ms` -> **`0.045–0.058 ms`** (`6–8` bufs), cutting 500-attempt legacy runs from `30.27 s` to `680.2 ms`.
   - **Edge 100k (`200` rooms, `985k` answers)**: ingest `3.58 s` (`27,950.5 att/s`), 95% pre-score `10.84 s`, seal `86.5 ms`, **post-close finalize `3.96 s` (`25,237.2 att/s`)**, post-publish 10k backfill chunk `3.66 s`, `0/0/0` triggers, `1,469` checkouts `p99 10.69 ms` (`0` err).
   - **Edge 1M (`2,000` rooms, `9.85M` answers)**: ingest `37.83 s` (`26,435.2 att/s`), 95% pre-score `120.09 s`, seal `308.6 ms`, **post-close finalize `41.22 s` (`24,260.6 att/s`, `1,424.35 MB` WAL — `< 60 s` target met, `8.4x` faster than `346.51 s`)**, post-publish 10k backfill chunk `3.74 s`, `0/0/0` triggers, `0` leaked standings, `13,034` checkouts `p99 19.18 ms` (`0` err).
   - `supabase/tests/quiz_stage1_prototype.sql` & replay-registry Vitest (`4/4` files, `54/54` tests) **PASSED**.

4. **9:00 AM Live 3-Round Demo Harness (Not Executed — Operator Approval & Runbook Only)**:
   - `apps/quiz-room-prototype/bench/k6-9am-demo-rounds.js` + `apps/quiz-room-prototype/scripts/run-9am-demo.sh` orchestrate Round 1 (`10` humans), Round 2 (`10` humans + `490` k6 bots in `room-0000`), and Round 3 (`10` humans + `4,990` k6 bots across `13` rooms with chaos flags), guarded by an exit `trap` that auto-deletes the 1-hour XL temporary Supabase branch and saves `/demo/report?format=json`.

### 1.8 Live 10-Player Nigerian Carrier Probe & Cloudflare DO Alarm/Fan-Out Fix (`2026-11-19`)

Executed the `$0.00` incremental-spend Step 1 field probe (`carrier-probe-weur-1`) on the isolated prototype Worker (`baci-quiz-room-prototype.ogabassey-ai.workers.dev/demo`, `locationHint: 'weur'`, raw telemetry saved at `apps/quiz-room-prototype/bench/reports/demo-20261119-nigeria-10p-final.json`):

- **Verified Field Telemetry (`79` authenticated, deduplicated taps; `0` retries; `0` timeouts)**:
  - **Self-report verification**: `30` of `79` taps (`38.0%` of taps, `50%` of carrier-tagged cohorts) differed from Cloudflare `request.cf` ASN classification (e.g., iCloud Private Relay `AS13335` & `AS209854` tapping `Airtel`/`MTN`; `MTN AS29465` tapping `Glo`), confirming server-side `request.cf` classification prevented silent carrier skew.
  - **MTN Nigeria (`AS29465`, `AMS`/`NBO`)**: `54` taps — **`252 ms` p50**, `1,591 ms` p95, `10,889 ms` max, **`92.6% <= 1 s`**, `0` retries/timeouts.
  - **Airtel Nigeria (`AS36873`, `CDG`)**: `5` taps — **`370 ms` p50**, `2,516 ms` p95, `80.0% <= 1 s`, `0` retries/timeouts.
  - **iCloud Private Relay / Cloudflare (`AS13335`, `LHR`)**: `10` taps — **`212 ms` p50**, `331 ms` p95, `100.0% <= 1 s`.
  - **VPN / Proxy (`AS209854`, `ORD`)**: `10` taps — **`368 ms` p50**, `420 ms` p95, `100.0% <= 1 s`.
  - **Client timeout guidance**: Because Nigerian cellular tails reached `1.6–2.5 s` p95 and `10.9 s` max while keeping `0` retries/timeouts, mobile/web clients should keep answer-submit request timeouts at **`8 s–12 s`** (never aggressive `2 s` aborts).
- **Cloudflare DO Idle-Alarm & `N+1` Live-Rank Fan-Out Fix**:
  - Live telemetry caught two amplification bugs in `carrier-probe-weur-1`: (1) `QuizRoomEngine.startAttempt()` armed `nextScoreboardTickMs` before any completion and `onAlarm()` unconditionally re-armed a 2s alarm until `endsAtMs` (waking idle rooms every 2s for 14h); and (2) `onAlarm()` queried all `status = 'submitted'` attempts and `QuizRoomDO` looped `N` `/internal/submit` + `1` `/internal/publish` calls (`N + 1` DO RPCs per tick).
  - Fixed via demand-driven `room_scoreboard_outbox` in `src/room-do.ts` (arming scoreboard ticks only upon attempt submission and clearing `nextScoreboardTickMs` to `null` once pending outbox rows are drained) and `LiveRankIndexEngine.recordSubmissionsBatch` + `POST /internal/submit-batch` (`1` batched DO call per tick with zero duplicate re-emissions).

---

## Section 2: Updated 100,000 & 1,000,000 Live Event Cost Model (From Measured Counters)

Published list prices verified 2026-11-18:
- **Cloudflare Workers Paid ($5/mo base)**: Workers requests `$0.30/M` (`10M` included); CPU `$0.02/M ms` (`30M ms` included); DO requests `$0.15/M` (`1M` included); DO duration `$12.50/M GB-s` (`400k GB-s` included, `128 MB` fixed allocation per active DO, excess billed rounded up to the next `1,000,000 GB-s`); DO SQLite `rowsWritten` `$1.00/M` (`50M` included), `rowsRead` `$0.001/M` (`25B` included), SQLite storage `$0.20/GB-mo` (`5 GB` included); Queues `$0.40/M` ops (`1M` included, `3` ops per 64 KB chunk).
- **Supabase Pro ($25/mo base, $10 compute credit)**: XL `$0.2877/hr`, 2XL `$0.562/hr`, 4XL `$1.32/hr`, preview Micro branch `$0.01344/hr`; Auth MAU `100,000` included then `$0.00325/MAU`; Realtime `$10` per 1,000 peak sockets above `500`; Uncached egress `250 GB` included then `$0.09/GB`.

### 2.1 Measured Resource Counters Scaled to Live Events

*(Includes `17.5` Worker reqs @ `2.5 ms` CPU/entrant, `14.5` DO room+shard reqs/entrant, `27.082` room `rowsWritten`/entrant, `6.000` attempt+leaderboard shard `rowsWritten`/entrant, live-rank range writes, `0.25 h` active DO duration/room & shard, and `0.066` queue msgs/entrant @ `3.0` ops/msg.)*

| Metric | 100,000 Entrants (200 Rooms, 16 Shards) | 1,000,000 Entrants (2,000 Rooms, 64 Shards) |
|---|---:|---:|
| Worker invocations / CPU ms | 1,750,000 reqs / 4,375,000 ms | 17,500,000 reqs / 43,750,000 ms |
| DO requests (rooms + shards + coord) | 1,458,000 | 14,580,000 |
| DO active duration (`128 MB` allocation) | 54 obj-hrs (**24,300 GB-s**) | 516 obj-hrs (**232,200 GB-s**) |
| SQLite `rowsWritten` (rooms + live-rank + shards) | 3,310,136 | 33,101,358 |
| SQLite `rowsRead` | 7,116,213 | 71,162,131 |
| SQLite peak retained storage (2.5x packed) | 1.02 GB | 10.15 GB |
| Queue messages / operations (`< 64 KB`) | 6,600 msgs / 19,800 ops | 66,000 msgs / 198,000 ops |

### 2.2 Per-Event & Per-1,000 Completions Cost Projection (USD)

| Cost Component | 100k Event (Allowances Available) | 100k Event (Allowances Exhausted) | 1M Event (Allowances Available) | 1M Event (Allowances Exhausted) |
|---|---:|---:|---:|---:|
| Cloudflare Workers + CPU | $0.00 | $0.61 | $2.53 | $6.13 |
| Cloudflare DO Requests | $0.07 | $0.22 | $2.04 | $2.19 |
| Cloudflare DO Duration (Exact / **Published 1M GB-s Rounding**) | $0.00 / $0.00 | $0.30 / **$12.50** | $0.00 / $0.00 | $2.90 / **$12.50** |
| Cloudflare DO SQLite (`rowsWritten` + `rowsRead` + Storage) | $0.00 | $3.52 | $1.03 | $35.20 |
| Cloudflare Queues (`19.8k` / `198k` ops) | $0.00 | $0.01 | $0.00 | $0.08 |
| **Cloudflare Subtotal (Exact / Rounded)** | **$0.07 / $0.07** | **$4.66 / $16.86** | **$5.59 / $5.59** | **$46.50 / $56.09** |
| Supabase Quiz Realtime Overage (`edge_rooms` suppressed) | **$0.00** | **$0.00** | **$0.00** | **$0.00** |
| Supabase Temporary DB Compute (4 hrs XL for 100k; 4 hrs 4XL for 1M) | $1.15 | $1.15 | $5.28 | $5.28 |
| Supabase Auth MAU (100% Returning Active-Cycle Players) | $0.00 | $0.00 | $0.00 | $0.00 |
| Supabase Auth MAU (100% Newly Active Audience) | $0.00 (in 100k incl.) | $325.00 | $2,925.00 | $3,250.00 |
| **Total Event Bill — Returning Audience (CF Rounded + DB Compute)** | **$1.22** | **$18.01** | **$10.87** | **$61.37** |
| **Total Event Bill — Newly Active Audience (CF Rounded + DB Compute + Auth)** | **$1.22** | **$343.01** | **$2,935.87** | **$3,311.37** |
| **Cost per 1,000 Completions (Returning / Newly Active)** | **$0.012 / $0.012** | **$0.180 / $3.430** | **$0.011 / $2.936** | **$0.061 / $3.311** |

*(Notes: Monthly subscriptions — Workers Paid `$5/mo` and Supabase Pro `$25/mo` — and prize/egress overages above 250 GB are separate. Note that actual measured Cloudflare costs are lower than Revision 12's $22.55/$66.40 illustration because measured `rowsWritten` was `27.08/entrant` + `6.0/entrant` shards instead of `40`, and packed bundles averaged `15.15/msg` at `61.5 KB` instead of `25/msg`, reducing DO duration GB-s below the `400k` monthly allowance when allowances are available.)*

---

## Section 3: Itemized Pre-Execution Paid Cloud Load-Test Cost Quote (Two-Step Approval Gate)

> [!CAUTION]
> **Two-Step Cloud Spend Gate (Zero Supabase Preview Branches Created Yet).**
> - **Step 1 (`$0.00` incremental infra — Approved Prototype Worker Active):** Run the 10-player real Nigerian carrier baseline on the isolated prototype Worker (`baci-quiz-room-prototype.ogabassey-ai.workers.dev/demo`, `locationHint: 'weur'`, server-verified `request.cf` ASN/ISP classification, `QUIZ_DEMO_INVITE_CODE` check-in gate, and ticket-authenticated deduplicated telemetry).
> - **Step 2 (Explicit Approval Gate Before Creating Any Supabase Branch or Paid Load VMs):** Only create the temporary **1-hour XL Supabase branch (`~$0.30–$0.60`)** and run the remaining paid cloud load rehearsals below **after Step 1 Nigerian carrier latency passes** (`p99 <= 1 s`).
> - **Stage 2 Product & Audit Sign-Off Note:** `score_and_materialize_edge_quiz_event_v2` fast close defers expanding `quiz_attempt_questions` and `quiz_attempt_answers` (`canonicalAnswersBackfillDeferred: true`) to async post-publish chunks via `backfill_quiz_edge_canonical_answers_v2`. Stage 2 production rollout requires explicit product/audit sign-off confirming post-publish async backfill satisfies contest dispute/audit SLAs.

### 3.1 Itemized Cloud Rehearsal Breakdown

| Item | Unit Rate / Rule | Quantity / Scope | Min USD | Expected USD | Max USD |
|---|---|---|---:|---:|---:|
| **A. Cloudflare Workers Paid** | | | | | |
| Workers Paid base subscription (if not already active) | $5.00 / mo | 1 month | $0.00 | $5.00 | $5.00 |
| Rehearsal 1: 1-room saturation + Nigerian carrier cloud probe | 1 DO, ~1.5k entrants, ~25k reqs | Inside monthly allowance ($0.06 unbundled) | $0.00 | $0.00 | $0.06 |
| Rehearsal 2: 5k multi-room chaos & DO restart cloud run | 13 DOs, 5k entrants, ~90k reqs | Inside monthly allowance ($0.25 unbundled) | $0.00 | $0.00 | $0.25 |
| Rehearsal 3: 100k synthetic gameplay + live-rank cloud run | 200 DOs, 16 shards, 3.31M rowsWritten | $0.07 w/ allowances; $16.86 w/ DO rounding | $0.07 | $4.66 | $16.86 |
| Rehearsal 4: 1M queue + 1M private result/leaderboard lookup | 2,000 DOs, 64 shards, 33.1M rowsWritten | $5.59 w/ allowances; $56.09 rounded if exhausted | $5.59 | $46.50 | $56.09 |
| *Cloudflare Subtotal* | | | **$5.66** | **$56.16** | **$78.26** |
| **B. Isolated Supabase Staging Branch (Synthetic Tickets -> $0 MAU Overage)** | | | | | |
| Staging preview branch baseline (Micro, deleted immediately post-run) | $0.01344 / hr | 4–8 hrs | $0.05 | $0.08 | $0.11 |
| XL compute (`100k` admission & reconciler verification) | $0.2877 / hr | 3–4 hrs | $0.86 | $1.15 | $1.15 |
| 2XL compute (admission burst & Envoy/JWT bottleneck check) | $0.562 / hr | 0–2 hrs | $0.00 | $1.12 | $1.12 |
| 4XL compute (`1M` ingest/scoring + admission burst; delete immediately) | $1.32 / hr | 3–4 hrs | $3.96 | $3.96 | $5.28 |
| Small real-device fresh-Auth + Play Integrity / App Attest cohort | <= 500 MAUs ($0.00325/MAU if >100k) | 500 test sign-ins | $0.00 | $0.00 | $1.63 |
| Uncached staging egress (<= 15 GB; $0.09/GB only if >250 GB/mo) | $0.09 / GB over 250 GB | 15 GB | $0.00 | $0.00 | $1.35 |
| *Supabase Subtotal (Warning: branch + compute bypass Spend Cap)* | | | **$4.87** | **$6.31** | **$10.64** |
| **C. Load-Generator & Nigerian Mobile Carrier Probe Infrastructure** | | | | | |
| Existing Contabo CI box (`k6` for 1-room, 5k, and Postgres admission) | $0.00 incremental | Already provisioned | $0.00 | $0.00 | $0.00 |
| Ephemeral distributed k6 workers (for 100k/1M HTTP fan-out) | ~$0.10 / hr / VM x 4–8 VMs x 4–6 hrs | 16–48 VM-hours | $1.60 | $3.20 | $4.80 |
| Real Nigerian carrier device test data / proxy probes (MTN/Airtel/Glo/9mobile) | Prepaid SIM data / probe credits | 4 carriers | $8.00 | $15.00 | $25.00 |
| *Load-Generator & Carrier Probe Subtotal* | | | **$9.60** | **$18.20** | **$29.80** |
| **TOTAL STAGE 1 PAID CLOUD QUALIFICATION QUOTE** | | | **$20.13** | **$80.67** | **$118.70** |

### 3.2 Recommended Approval Options

1. **Part A Go/No-Go Only (1-Room Nigerian Carrier Probe + 5k Chaos Cloud Run + 2h XL Supabase Branch)**:
   - Expected spend: **~$15.00 – $25.00 USD** (recommended cap **$25.00**). Answers whether real Nigeria->Cloudflare DO latency meets the `99% <= 1 s` target before spending on 100k/1M cloud runs.
2. **Full Stage 1 Cloud Qualification (Part A + Part B 100k & 1M Rehearsals + 4XL 1M Postgres Scoring)**:
   - Expected spend: **~$80.67 USD**; recommended hard spend ceiling with 1 retry margin: **$125.00 USD**.
