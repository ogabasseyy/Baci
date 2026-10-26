# Task 9 local release verification — 2026-10-22

## Decision and scope

**Production NO-GO. Task 9 is partial.** Owner chose a local database instead of a paid hosted project. No remote provisioning, production mutation, submission change, upload, push or merge is included. Both existing submissions are preserved.

## Local evidence

- Isolated PostgreSQL17.11 Unix-socket fixtures; native PostgREST16.4. No production data or credentials copied.
- Affected builder suites: 42 files passed, 129 tests passed; 3 files/4 opt-in tests skipped. The browser parity opt-in was then enabled separately and passed. The remaining privacy probe requires Docker and is not qualified here.
- Sixteen native broker suites: 30 tests passed, including normal-user Data API access, rejection of outer builder tokens, private-schema denial, storage-role boundaries, edit concurrency, refresh and revocation. The seventeenth real upstream GoTrue integration remains blocked by unavailable Docker; no mocked replacement is counted as that integration.
- Signed-token HTTP create/edit runs through real local PostgREST; its upstream Auth-user response is simulated. SQL lifecycle starts from seeded consent and stops at `verifying`, not independently verified public delivery.
- Root lint: 5 tasks passed. Root typecheck: 7 tasks passed. Separate native broker typecheck passed. Remaining workspace packages passed all 6 test tasks (4 cached); the explicit PostgreSQL17 Turbo rerun passed 6 files/21 tests. These targeted runs do not replace the failed full-web result below.
- Codex independently reviewed the current Task9 patch with no actionable code defect. Its two stale local/remote scope statements were corrected.
- The stale-draft result normalization has a regression through the real SQL negative journey. Native Node tests use a separate runner; their exclusion retains Vitest default exclusions. Turbo forwards and hashes the explicit local database selection.

## Artifact identity

Editor-free preview plus standalone MCP adapter rebuilt successfully. Hashes match previous independent builds:

| Artifact | SHA-256 |
| --- | --- |
| `builder-mcp-server/dist/server.mjs` | `36ea97aad5a17b90f7dce0c2ff2af6c81ee1a0bfb8a0dcd395131bffe6b6ecf2` |
| `builder-mcp-server/dist/preview.html` | `6b789ccd1b164b4801cee3946b0a31a163073e186ba673199dbd279ec135b7a5` |

These are not a complete web/auth/runner/verifier release. The new package is source-only, without an invented endpoint binding or upload-ready ZIP. Deployment contracts remain disabled.

## Broad-suite failure accounting

The full web run completed with 8515 passed files and 15 failed files (54559 passed tests, 29 failed; one worker error). This is not a green root test gate.

- Builder database failures came from Turbo dropping local selection flags in that run. The task environment/cache contract was fixed, and affected PostgreSQL17 suites were rerun.
- New lifecycle helper violated the test-only import boundary. It was renamed to `lifecycle.test-utils.ts`; the actual repository boundary test passed in the affected rerun.
- Cost process-isolation test requires a clean tooling worktree; this run was intentionally uncommitted.
- Inventory snapshot mismatch, event-pipeline credential-reader hash drift and analytics-authority contracts remain failures outside this local fixture patch. The analytics contract evaluates the accumulated branch, including prior builder work; no exemption or baseline rewrite was added.
- A jsdom worker startup error is recorded separately from application assertions.

Machine logs, commands, review receipts and per-run outcomes are retained in `.superpowers/sdd/2026-10-20-baci-chatgpt-store-builder/` locally. Do not treat historical failures or narrower successful reruns as a full-root pass.

## Remaining release gates

Pinned Supabase/GoTrue and complete compatible-schema migration replay; privacy expand/backfill/cutover and consumer compatibility; staging profile and complete runtime bootstraps; real ChatGPT OAuth/discovery/UI journey; independent public delivery and rollback; exact committed release identity and complete inspected package. See [runbook](../../connectors/baci-chatgpt-builder-runbook.md). No production or submission authority is granted by passing local checks.
