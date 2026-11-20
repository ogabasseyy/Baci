# Quiz 100k–1M Stage 1 Prototype & Live Nigeria Field Test — Agent Handover

Date: 2026-11-19 · Branch: `feat/quiz-stage1-prototype` (off `origin/main` `5141bd4d71`) · Canonical Worktree: `/Users/mac/Baci-worktrees/quiz-stage1-prototype`

> [!IMPORTANT]
> **Workspace Isolation & Zero-Spend Status (`\$0.00` Billed To Date).**
> - **DO NOT modify `/Users/mac/Baci-app`** for Stage 1 work — it sits on an unrelated dirty branch (`fix/mobile-admin-signup-skip-owner`). Do all Stage 1 work inside `/Users/mac/Baci-worktrees/quiz-stage1-prototype`.
> - **Cloudflare account `17f9bcc57406cccc35f867a0545fa5ed` (`ogabassey-ai`) is currently on the Workers Free tier** (`100,000` Durable Object requests/day hard cap, resets daily at `00:00 UTC`; Cloudflare Queues also requires upgrading to the \$5/month Workers Paid plan before Step 2).
> - **Zero paid Supabase preview branches have been created.** Never create a paid Supabase branch or resize compute without explicit user approval in chat.

---

## 1. Where Everything Lives

### Git Worktrees & Key Files
- **Canonical integrated worktree:** `/Users/mac/Baci-worktrees/quiz-stage1-prototype` (`feat/quiz-stage1-prototype`)
  - Target architecture plan (Revision 12): [2026-11-18-quiz-100k-1m-scale-plan.md](file:///Users/mac/Baci-worktrees/quiz-stage1-prototype/docs/superpowers/plans/2026-11-18-quiz-100k-1m-scale-plan.md)
  - Full Stage 1 benchmark & cost report: [2026-11-18-quiz-stage1-prototype-results-and-paid-test-quote.md](file:///Users/mac/Baci-worktrees/quiz-stage1-prototype/docs/superpowers/plans/2026-11-18-quiz-stage1-prototype-results-and-paid-test-quote.md)
  - Raw 10-player Nigeria carrier JSON: [demo-20261119-nigeria-10p-final.json](file:///Users/mac/Baci-worktrees/quiz-stage1-prototype/apps/quiz-room-prototype/bench/reports/demo-20261119-nigeria-10p-final.json)
  - Edge Worker & Durable Objects:
    - [index.ts](file:///Users/mac/Baci-worktrees/quiz-stage1-prototype/apps/quiz-room-prototype/src/index.ts), [room-do.ts](file:///Users/mac/Baci-worktrees/quiz-stage1-prototype/apps/quiz-room-prototype/src/room-do.ts), [live-rank.ts](file:///Users/mac/Baci-worktrees/quiz-stage1-prototype/apps/quiz-room-prototype/src/live-rank.ts), [result-shard.ts](file:///Users/mac/Baci-worktrees/quiz-stage1-prototype/apps/quiz-room-prototype/apps/quiz-room-prototype/src/result-shard.ts), [coordinator.ts](file:///Users/mac/Baci-worktrees/quiz-stage1-prototype/apps/quiz-room-prototype/src/coordinator.ts), [queue-consumer.ts](file:///Users/mac/Baci-worktrees/quiz-stage1-prototype/apps/quiz-room-prototype/src/queue-consumer.ts)
    - Demo & ASN/ISP verification: [demo-isp.ts](file:///Users/mac/Baci-worktrees/quiz-stage1-prototype/apps/quiz-room-prototype/src/demo-isp.ts), [demo-routes.ts](file:///Users/mac/Baci-worktrees/quiz-stage1-prototype/apps/quiz-room-prototype/src/demo-routes.ts), [demo-player-routes.ts](file:///Users/mac/Baci-worktrees/quiz-stage1-prototype/apps/quiz-room-prototype/src/demo-player-routes.ts), [demo-finalizer.ts](file:///Users/mac/Baci-worktrees/quiz-stage1-prototype/apps/quiz-room-prototype/src/demo-finalizer.ts), [demo-state.ts](file:///Users/mac/Baci-worktrees/quiz-stage1-prototype/apps/quiz-room-prototype/src/demo-state.ts), [demo-ui.ts](file:///Users/mac/Baci-worktrees/quiz-stage1-prototype/apps/quiz-room-prototype/src/demo-ui.ts)
  - PostgreSQL migration & pgTAP/SQL tests:
    - [20261118170000_quiz_stage1_edge_prototype_v2.sql](file:///Users/mac/Baci-worktrees/quiz-stage1-prototype/supabase/migrations/20261118170000_quiz_stage1_edge_prototype_v2.sql)
    - [quiz_stage1_prototype.sql](file:///Users/mac/Baci-worktrees/quiz-stage1-prototype/supabase/tests/quiz_stage1_prototype.sql)
  - Mobile Realtime suppression (`backendMode: 'edge_rooms'`):
    - [use-quiz-result-polling.ts](file:///Users/mac/Baci-worktrees/quiz-stage1-prototype/apps/mobile-storefront/components/quiz/use-quiz-result-polling.ts), [QuizScreen.tsx](file:///Users/mac/Baci-worktrees/quiz-stage1-prototype/apps/mobile-storefront/components/quiz/QuizScreen.tsx), [use-quiz-result-polling.edge-backend.test.ts](file:///Users/mac/Baci-worktrees/quiz-stage1-prototype/apps/mobile-storefront/components/quiz/use-quiz-result-polling.edge-backend.test.ts)
  - Local benchmarks & scripts:
    - [open-loop-workerd-bench.mjs](file:///Users/mac/Baci-worktrees/quiz-stage1-prototype/apps/quiz-room-prototype/bench/open-loop-workerd-bench.mjs), [e2e-queue-pg-replay.mjs](file:///Users/mac/Baci-worktrees/quiz-stage1-prototype/apps/quiz-room-prototype/bench/e2e-queue-pg-replay.mjs), [k6-9am-demo-rounds.js](file:///Users/mac/Baci-worktrees/quiz-stage1-prototype/apps/quiz-room-prototype/bench/k6-9am-demo-rounds.js), [run-9am-demo.sh](file:///Users/mac/Baci-worktrees/quiz-stage1-prototype/apps/quiz-room-prototype/scripts/run-9am-demo.sh)
- **Supporting author worktrees** (all under `/Users/mac/Baci-worktrees/`, each has an unstaged `node_modules -> /Users/mac/Baci-app/node_modules` symlink — never stage `node_modules`):
  - `quiz-stage1-room-worker` (synced to `ceb39eeba6`), `quiz-stage1-db-reconciler` (`111cecd65a`), `quiz-stage1-client-and-bench` (`3120913276`).

### Live Cloudflare Deployment & Local Secrets
- **Worker URL:** https://baci-quiz-room-prototype.ogabassey-ai.workers.dev (`Version ID: 6df385a1-d50e-4044-9e4b-80cb042adc2d`)
- **Tester Invite URL:** https://baci-quiz-room-prototype.ogabassey-ai.workers.dev/demo?code=baci-65dbab
- **Live Report URL:** https://baci-quiz-room-prototype.ogabassey-ai.workers.dev/demo/report (`?format=json`)
- **Active rounds:** `0` (`carrier-probe-weur-1` was sealed via `/api/demo/admin/finalize-round`; idle DO request rate is `0/sec`).
- **Local unversioned secrets file** (`chmod 600`, **never print or commit**):
  `/Users/mac/.gemini/antigravity/brain/b112ebe1-ef3d-4f93-a169-71e4149ba381/scratch/.demo-secrets.env`
  *(Contains `QUIZ_TICKET_SECRET`, `QUIZ_JWT_SECRET`, `QUIZ_INTERNAL_COORDINATOR_SECRET`, `QUIZ_DEMO_INVITE_CODE=baci-65dbab`.)*

### Host Mac CLI Notes
- **Wrangler (`4.115.0`):** Always run with `NODE_OPTIONS="--dns-result-order=ipv4first" /Users/mac/Baci-app/node_modules/.bin/wrangler ...` (Node 24 otherwise stalls 60s on IPv6 DNS for `api.cloudflare.com`).
- **Supabase CLI (`v2.117.0`):** `/opt/homebrew/bin/supabase`, linked to Baci `aivqthbxdshhltbwipbr` (`eu-west-1` Ireland).
- **`k6`:** Not installed locally on this Mac (`command not found: k6`). Install via `brew install k6`, run from Contabo (`bassey@82.29.190.219`), or use a Node 24 open-loop script (`fetch`) on this Mac.
- **Shared Mac Testing Rule:** Run only scoped Biome / `tsc` / Vitest / Jest checks on touched files — never full monorepo suites in a loop.

---

## 2. What Has Been Proven & Fixed

### A. Live 10-Player Nigerian Mobile Carrier Probe (2026-11-19)
- **Volume & reliability:** `79` verified answer taps across `10` participants (`0` client retries, `0` failed requests, `weur` DO placement).
- **Verified ISP breakdown (`request.cf.asn`):**
  - **MTN Nigeria (`AS29465`):** `54` taps — **`252 ms` p50**, `1,591 ms` p95, `10,889 ms` max, **`92.6% <= 1s`** (`AMS`, `NBO` colos).
  - **Airtel Nigeria (`AS36873`):** `5` taps — **`370 ms` p50**, `2,516 ms` max, **`80.0% <= 1s`** (`CDG` colo).
  - **Cloudflare London (`AS13335`, iCloud Private Relay / WARP):** `10` taps — **`212 ms` p50**, `331 ms` max, **`100% <= 1s`** (`LHR` colo).
  - **Private Customer (`AS209854`, VPN):** `10` taps — **`368 ms` p50**, `420 ms` max, **`100% <= 1s`** (`ORD` colo).
- **Key architectural findings from real phones:**
  1. **ASN verification caught `50%` (`30/60`) self-report mismatches** (dual-SIM data routing over MTN when user tapped Glo, iCloud Private Relay on Airtel iPhone, active VPN).
  2. **Client answer timeout rule:** Because real Nigerian LTE exhibits occasional `1.5s–10.9s` radio stalls while server DO latency is `< 5 ms`, the mobile app per-answer HTTP timeout **must be `8s–12s`** (with idempotent retry), never `1.5s–2s`.
  3. **Idle scoreboard alarm & `N+1` fan-out bug caught and fixed (`ceb39eeba6`):** Leaving a warmup room open for 14 hours exposed an unconditional 2s alarm + per-player `LiveRankIndexDO` loop (`~95,000` DO requests). Fixed via `room_scoreboard_outbox` + one-time upgrade seed + `POST /internal/submit-batch` (`<= 20` DO requests for the same 14h scenario; `125x` fewer scoreboard DO requests at 100k scale).

### B. Local Scale & Correctness Proofs
1. **Single-room capacity:** `500 players/room` (`27.08` `rowsWritten`/entrant, `62.25` `rowsRead`/entrant, `0.168 ms` SQLite commit p99; open-loop `workerd` HTTP verified up to `600 req/s` with `0` errors).
2. **Chaos & lost-batch replay (`e2e-queue-pg-replay.mjs`):** Proven against real PostgreSQL `17.11` (`5,000/5,000` attempts, two-fact publication gate held while 1 batch dropped, replayed from `room_batches`, `1` winner awarded).
3. **100k LiveRankIndex & 1M ResultShards:** `1,452x` range-write reduction under 80% ties; `1M` private result (`0.126 ms` p99) + leaderboard (`1.413 ms` p99) lookups with `0` non-winner Postgres hits.
4. **1M PostgreSQL 17 incremental scoring:** Unfiltered `idx_customers_merchant_quiz_normalized_email_all` (`57.6–176.9 ms -> 0.045–0.058 ms`); streaming pre-close scoring + deferred legacy `quiz_attempt_answers` backfill cut 1M post-close finalize from **`346.51 s` -> `41.22 s`**.
5. **Mobile Realtime suppression:** `26/26` Jest tests passing (`0` `quiz-results` channel joins on `edge_rooms`).

---

## 3. Recommended Next Steps (In Priority Order)

### Priority 1 — Black Friday (Nov 27, `<= 10,000` Players) Safe Track (`\$0`, Fast & Low-Risk)
Do **not** rush the 3,025-line Cloudflare Edge Rooms migration into `main` before Nov 27. Instead:
1. **Open a tiny, isolated Stage 0 Draft PR off `origin/main`** (`gh pr create --draft`) with **only** the two zero-risk standalone fixes:
   - Add unfiltered index `idx_customers_merchant_quiz_normalized_email_all` on `public.customers (merchant_id, public.quiz_normalize_email(email))` in a small standalone migration (`~3,000x` faster check-in/trigger lookup).
   - Add `submittedAt` to `private.quiz_attempt_state_v2` JSON return if needed by mobile UI.
2. **Verify the `HS256` vs `ES256` JWT throughput path for Nov 27:**
   - Earlier load testing ([2026-11-18-quiz-loadtest-results.md](file:///Users/mac/Baci-app/docs/superpowers/plans/2026-11-18-quiz-loadtest-results.md)) showed `HS256` ran **`3.3x` faster** (`672 req/s` vs `205 req/s`) through Supabase PostgREST. Confirming whether Baci's current mobile/web auth can issue/use `HS256` (or cached verification) could let existing Postgres comfortably absorb `5,000–10,000` Black Friday players with zero architecture swap.

### Priority 2 — Optional Remaining Stage 1 Cloud Rehearsals (Post-Black-Friday or After Quota Reset)
1. **500-player single-room live burst (`\$0` after `00:00 UTC` DO free-tier reset):**
   - Write a 100-line Node 24 bot runner (do **not** post bot rows to `/api/demo/telemetry` so human carrier stats stay unpolluted; note [k6-9am-demo-rounds.js](file:///Users/mac/Baci-worktrees/quiz-stage1-prototype/apps/quiz-room-prototype/bench/k6-9am-demo-rounds.js#L167-L185) currently posts bot telemetry) to drive `490` concurrent bots into `room-0000` while 1–2 human phones play alongside them, verifying `~250 ms` p50 under full 500-player room load and confirming `< 20` DO scoreboard calls.
2. **Full 5,000-player Cloudflare Queue -> Supabase branch reconciliation (`~\$5/mo` CF Workers Paid + `~\$0.30–\$0.60` 1-hr Supabase XL branch):**
   - Requires explicit user approval, upgrading Cloudflare from Workers Free to **Workers Paid (\$5/month)** so Cloudflare Queues (`QUIZ_BATCH_QUEUE`) and >100k DO reqs/day are enabled, and running Step 2 against a trap-deleted 1-hour Supabase branch on `aivqthbxdshhltbwipbr`.

### Priority 3 — Stage 2 Production Readiness Checklist (Before Opening Any Edge-Rooms PR)
- **Modularize oversized prototype files** to `<= 300` lines per `.ruler/02-code-standards.md` (`room-do.ts` is `1,860` lines, `index.ts` is `1,044` lines, `live-rank.ts` is `911` lines).
- **Decouple SQL migration from live `postgres`-mode functions:** Keep legacy `postgres`-mode quiz RPCs/finalizers untouched and scope all new logic strictly to `*_edge_*_v2` functions gated behind `backend_mode = 'edge_rooms'`.
- **Owner sign-off on dispute workflow:** Confirm admin/dispute tooling reads `private.quiz_edge_attempt_staging` (available pre-publish) or tolerates async post-publish backfill into `public.quiz_attempt_answers`.
