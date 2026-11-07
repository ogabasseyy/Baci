# Agentic Commerce Program Tracker

The single place to see where the agentic commerce work stands and what happens next. Update it whenever a step finishes: tick the box, add the date, and add the PR link or commit.

- **Roadmap:** [2026-10-29-agentic-ucp-completion.md](2026-10-29-agentic-ucp-completion.md). It holds the findings (F1–F42), the milestones and the tasks.
- **Plans:** one executable plan per pull request, saved as `2026-MM-DD-agentic-m<milestone>-<n>-<name>.md` in this folder.

## Now

| | |
| --- | --- |
| **Current plan** | Milestone 0: plan 1 ([ogabasseyy/Baci#3869](https://github.com/ogabasseyy/Baci/pull/3869), head `83270eaf68`), plan 2 ([ogabasseyy/Baci#3873](https://github.com/ogabasseyy/Baci/pull/3873), stacked, head `dded9ca801`) and plan 3 ([ogabasseyy/Baci#3884](https://github.com/ogabasseyy/Baci/pull/3884), stacked on #3873, head `bcf4117fa3`) were synced with main on 31 Oct and are back in Codex review; each was Codex-clean on its previous head |
| **Next action** | Fix Codex findings on #3884 as they arrive; write plan 4 (minor units and the confirmation contract) while reviews run. With the owner's merge approval: wait for CI and Codex on #3869's head (merge main in again first if it has moved), merge; then retarget #3873 to main, merge main into it (no force-push) and redo its register re-review; then the same for #3884 |
| **Waiting on the owner** | Merge of docs PR [ogabasseyy/Baci#3851](https://github.com/ogabasseyy/Baci/pull/3851) (recommended after Milestone 0); merge approval for #3869, then #3873, then #3884 (each merge deploys); the plan 5 VAT decision (the merchant is VAT-registered at 7.50%); plan 3's four decisions, which proceed on their defaults unless the owner objects |
| **Last updated** | 31 October 2026 |

## How every plan moves (the loop)

Each plan goes through these steps in order. A step is done only with evidence: a link, a commit, test output or a dated note.

1. **Latest-docs check.** Before writing or building, check the current specs and library docs the plan depends on (see "Latest-docs rule"). Record the result in the docs log below. If something changed, add a finding to the roadmap first.
2. **Write the plan.** Use exact files, complete code, exact commands, and TDD steps.
3. **Independent review.** A reviewer that did not write the plan checks it. Apply the valid findings and record each review round.
4. **Build with TDD.** One fresh worker per plan task: write the failing test, run it red, write the code, run it green, then commit. The orchestrator reviews each task's diff before the next starts. A task without red-then-green evidence is not done.
5. **Local gates.** The tests the change touches, affected-package checks, and the capability gate when cited files change. Run `coderabbit review --agent -t uncommitted` before each commit and fix valid critical or high findings. **Owner-approved exception (31 Oct):** when CodeRabbit is rate-limited or unavailable, the owner's standing instruction is to keep building rather than stop. Record the gate as not run in the task report and the PR body, never claim it ran, and rely on the Codex review of the draft PR and the required AI-review gate (step 7) before any merge. Full suites run in CI.
6. **Pull request.** Push commits as checkpoints and open a **draft** PR early, then comment `@codex review`. Keep building the next task while reviews run, and fix findings as they arrive (owner's preference, 31 Oct).
7. **PR gates.** CI green on the latest commit; Codex verdict ("Didn't find any major issues" issue comment for that commit); the required AI-review gate; every review thread resolved. Any rebase restarts this step.
8. **Merge.** Only with the owner's approval. Merging to main starts the production deploy (database migrations first), so approving the merge approves the deploy.
9. **Production check.** Run the plan's read-only verification and record the result. A merged migration is not proof that it was applied.

## Who does what (cost)

| Work | Model |
| --- | --- |
| Orchestrating; writing plans; design and security decisions; reviewing each task's diff; hard debugging; payment and SQL authority changes | Opus (orchestrator) |
| Building plan tasks with TDD; applying review fixes; independent plan reviews; protocol-doc comparisons | Sonnet |
| Mechanical work: code searches and line inventories, registry hashes and counts, renames, running suites and summarizing failures, link and version lookups | Haiku |

Default to Sonnet for building and Haiku for read-only or mechanical work. Escalate to Opus only for orchestration, reviews and problems a cheaper model could not resolve.

## Latest-docs rule

UCP and the agent protocols change quickly. Before each plan is written and again before a protocol-facing task is built:

- Check the protocol sources: [UCP specification and releases](https://github.com/Universal-Commerce-Protocol/ucp/releases), [Google Merchant UCP guides](https://developers.google.com/merchant/ucp/guides/overview), [OpenAI commerce specs](https://developers.openai.com/commerce/specs/checkout), [MCP specification](https://modelcontextprotocol.io/specification) and the [Paystack docs](https://paystack.com/docs) for any payment work.
- For libraries and frameworks (Next.js, Supabase, Vitest, Zod, the MCP SDK), use Context7 for the version installed in the repo, not memory.
- Pin the version each plan targets. When a newer version exists, record it in the docs log and decide explicitly whether to adopt it. Never silently mix versions.

## Milestone 0: correct what is already exposed

### Plan 1: remove the admin client from agentic routes (roadmap Task 2)

Plan: [2026-10-30-agentic-m0-1-admin-client-removal.md](2026-10-30-agentic-m0-1-admin-client-removal.md)

- [x] Latest-docs check (30 Oct: protocol docs unaffected; Supabase JWT-role switching, imported ES256 signing keys and the definer-function pattern all confirmed)
- [x] Plan written (30 Oct; SQL proven in a throwaway Postgres; all 45 replacement snippets match main `1a17a9b900`)
- [ ] Independent review, fixes applied
- [x] Built with TDD (plan tasks 1–10, 30 Oct): every task red then green; the create-handler test was added during the build
- [x] Local gates passed (30 Oct): 40 test files and 195 tests, both SQL tests in a throwaway Postgres 17, capability gate (178 tests). CodeRabbit unavailable (rate-limited, no seat); full suites left to CI
- [x] PR opened (owner OK): draft [ogabasseyy/Baci#3869](https://github.com/ogabasseyy/Baci/pull/3869), 31 Oct; Codex review requested
- [x] Branch synced with main after #3860 (31 Oct, owner OK): rebuilt on `bec52f6033`, inventory and capability record regenerated once; pushed as `ede636ee97` with identical commit IDs
- [x] Codex P1 fixed and synced with main (31 Oct): payment-split tests moved to their own file (`598f51421c`); main merged in (`e8c6adf908`) instead of a rebase, so no force-push; inventory and register regenerated (`d05d0e0f6e`, `26fc3d4011`); 143 agentic tests, typecheck and capability gate pass; pushed with identical IDs, Codex re-requested
- [x] Codex clean on `26fc3d4011` (31 Oct); one CI shard failed on an unrelated timing test (`postcss-selector-parser` "scales linearly"), re-run. The branch is behind main again, so it is synced right before merging
- [ ] PR gates green
- [ ] Merged (owner OK, deploys)
- [ ] Production check: payment-split function live, `anon` cannot execute it

### Plan 2: baseline and evidence (roadmap Task 1)

- [x] Latest-docs check (31 Oct: no new protocol versions; fixtures pin UCP by commit because its tags were re-cut; new findings F40 and F41)
- [x] Plan written (31 Oct): [2026-10-31-agentic-m0-2-baseline-evidence.md](2026-10-31-agentic-m0-2-baseline-evidence.md), 10 tasks, rehearsed in a scratch copy of plan 1's head (106 tests pass, 9 known gaps fail as expected, capability gate OK). Task 1 needs the owner's OK: read-only queries of the agentic merchant's `premium_features` (`shared_cart`), `vat_registration_status` and the migration ledger, plus a plain GET of its public UCP profile.
- [x] Independent review, fixes applied (31 Oct): orchestrator review moved the validator and MCP fixtures under `src` so CI type-checks them; Codex on #3851 at `c699994a3d`: "Didn't find any major issues"
- [x] Built with TDD (31 Oct): 21 test files, 127 pass and 9 known gaps fail as expected; Codex's two P1s (one primary export per file) fixed in `3778e7aaa2`
- [x] Local gates passed (31 Oct): web typecheck, affected-package lint, capability gate `OK` (178 tests), register `fresh`; re-reviewed at `76b52d16ce`
- [x] PR opened (owner OK): draft [ogabasseyy/Baci#3873](https://github.com/ogabasseyy/Baci/pull/3873), base `fix/agentic-remove-admin-client`; final head `e4eacf287a`, Codex review requested
- [x] Codex P1s fixed and synced with plan 1 (31 Oct): conformance and Paystack fixture helpers split into one module each (`f119a47ba9`); plan 1's new head merged in (`33e82e0d65`); register re-reviewed (`1537b8d0a7`); 154 tests pass with 9 known gaps, web typecheck, lint, capability gate `OK`; pushed with identical IDs, Codex re-requested
- [x] Codex clean and CI green on `1537b8d0a7` (31 Oct)
- [ ] PR gates green
- [ ] Merged (owner OK, deploys)
- [x] Production check (none beyond Task 1, which ran read-only on 31 Oct: shared cart enrolled, VAT registered at 7.50%, migration ledger matches the repository, public profile 200 for plain and browser requests with no checkout declared)

### Plan 3: truthful capability claims and the shared-cart gate (roadmap Task 3)

- [x] Latest-docs check (31 Oct; see the docs log): stay on UCP `2026-04-08`; cart and catalog need `schema`; Google cart transfer is create-only and opt-out per product (US rollout only); OpenAI feed flags are `is_eligible_*` with `enable_*` aliases
- [x] Plan written (31 Oct): [2026-10-31-agentic-m0-3-truthful-claims.md](2026-10-31-agentic-m0-3-truthful-claims.md), 9 tasks; stacked on #3873 until plans 1 and 2 merge
- [x] Independent review, fixes applied (31 Oct): Codex on #3851 found one P2, fixed; clean at `91dfa63e86`. Jules naming fix applied
- [x] Built with TDD (31 Oct): tasks 1–5 red then green: schemas on every UCP capability (`4410218bb1`, F7), Google Pay withheld (`34bc91c812`), cart declared only for shared-cart merchants (`01089b9e73`, `a8f0665ba7`), cart routes fail closed before any reservation (`6d609958f6`, F34), feed `enable_checkout: false` (`f0dfa72a0a`, F6); F7 and F34 now pass in the conformance suite
- [x] Local gates passed (31 Oct): 427 agentic files, 25 `.well-known` files, the feed suites (127 tests) and the evidence tests (44) pass; two load timeouts passed on re-run. Full web typecheck clean on `6d609958f6`; lint in pre-commit. Inventory regenerated (`b7dc11a0c3`, 585 rows); register re-reviewed (`da9c6a5ccc`); capability gate `OK` (179 tests) against the PR base, register `fresh`. CodeRabbit rate-limited, skipped
- [x] PR opened (owner OK): draft [ogabasseyy/Baci#3884](https://github.com/ogabasseyy/Baci/pull/3884), base `chore/agentic-baseline-evidence`, head `da9c6a5ccc` pushed with identical IDs; Codex review requested
- [ ] PR gates green
- [ ] Merged (owner OK, deploys)
- [ ] Production check: `/.well-known/ucp` declares `schema` on every capability and no `com.google.pay`; the OpenAI feed rows say `enable_checkout: false`

### Plan 4: minor units and the confirmation contract (roadmap Task 4)

- [ ] Latest-docs check (UCP and ACP amount fields, current ACP API version)
- [ ] Plan written
- [ ] Independent review, fixes applied
- [ ] Built with TDD
- [ ] Local gates passed
- [ ] PR opened (owner OK):
- [ ] PR gates green
- [ ] Merged (owner OK, deploys)
- [ ] Production check

### Plan 5: VAT guard and VAT cutover (roadmap Task 4)

- [ ] Latest-docs check
- [ ] Plan written
- [ ] Independent review, fixes applied
- [ ] Built with TDD
- [ ] Local gates passed
- [ ] VAT cutover done: new completions held, DVA and pay-on-delivery sessions reconciled, rollout unblocked
- [ ] PR opened (owner OK):
- [ ] PR gates green
- [ ] Merged (owner OK, deploys)
- [ ] Production check

### Plan 6: merchant-owned fulfillment and the F29 fixtures (roadmap Task 4)

- [ ] Latest-docs check (UCP fulfillment fields)
- [ ] Plan written
- [ ] Independent review, fixes applied
- [ ] Built with TDD
- [ ] Local gates passed
- [ ] PR opened (owner OK):
- [ ] PR gates green
- [ ] Merged (owner OK, deploys)
- [ ] Production check

## Later milestones

Plans for these are written only when their milestone starts. Each row gets the same loop as above.

| Milestone | Roadmap task | Status | Waiting on |
| --- | --- | --- | --- |
| A | 5: protocol versions and partner authentication | Not started | Milestone 0 |
| A | 6: shared commerce and checkout authority | Not started | Milestone 0 |
| A | 7: discoverable, callable commerce functions | Not started | Milestone 0 |
| B | 8: product-feed parity | Not started | Milestone A |
| B | 9: Google cart transfer and MCP handoff | Not started | Milestone A; Google sandbox access |
| B | 10: interactive cards and ChatGPT conversion | Not started | Milestone A; OpenAI approval for conversion |
| B | 11: Google enrollment and account linking | Not started | Google program decision |
| B | 12: sandbox, operations and rollout | Not started | The selected partner |
| C | 13: payment-handler contracts | Not started | Milestone A; partner and Paystack payment contract |
| C | 14: order lifecycle events | Not started | Milestone A; partner webhook contract |
| D | 15: agent identity and buyer authority | Not started | Milestone A |
| D | 16: browser-agent tools (WebMCP) | Not started | Milestone B |
| D | 17: UCP `2026-08-25` and optional features | Not started | A partner that advertises it |
| D | 18: additional channels and payments | Not started | Partner decisions |

## Owner decisions

| Decision | Needed for | Status |
| --- | --- | --- |
| Commit the roadmap, plan 1 and this tracker to main in a docs-only PR, so every worktree and agent sees the same files | All plans | Approved 30 Oct; [#3851](https://github.com/ogabasseyy/Baci/pull/3851) open |
| Approve read-only production queries for plan 2's baseline (shared cart and VAT state) | Plan 2 | Approved and run 31 Oct |
| If the agentic merchant charges VAT: block its agentic completion until roadmap Task 6, or pull tax parity into Milestone 0 | Plan 5 | Open: it applies (VAT registered at 7.50%, per plan 2's baseline) |
| Fix the Context7 API key: Context7 rejects it ("Invalid API key"), so library-doc checks currently fall back to the official websites | Latest-docs rule | Open |
| Free space in Docker Desktop (its own disk is full; tests currently run the database in memory instead) | Convenience | Open |
| Verify Paystack's Google Pay page by hand: it blocks automated reads, so the 3DS and `PAN_ONLY` details are unconfirmed | Milestone C | Open |
| Partner access: Google UCP sandbox, OpenAI commerce approval, Paystack token and 3DS support | Milestones B–C | Open |
| OpenAI feed: every row `enable_checkout: false` until an OpenAI checkout integration is approved | Plan 3 | Default taken; owner may object |
| Google cart eligibility (F25): keep cart declared for shared-cart merchants, although Google treats every free-listing product as cart-eligible; per-product flags arrive with Task 8 | Plan 3 | Default taken; owner may object |
| Create-only UCP cart (F15): keep the declaration and record that `PUT` update is unsupported; confirm with Google in Task 9 | Plan 3 | Default taken; owner may object |
| Gated cart responses: `404 cart_unavailable` when not enrolled, `503 cart_availability_unknown` when enrollment cannot be read | Plan 3 | Default taken; owner may object |

## Latest-docs log

| Date | Source | Version or state found | Effect on the plans |
| --- | --- | --- | --- |
| 29 Oct | UCP | `2026-04-08` (Google's version) and `2026-08-25` (latest release) | Roadmap pins `2026-04-08`; `2026-08-25` is Task 17 |
| 29 Oct | MCP | `2026-07-28` | Roadmap F23 (`Mcp-Method` and `Mcp-Name` CORS headers) |
| 30 Oct | OpenAI checkout spec | Totals are integers in minor units; the page shows `API-Version` `2025-09-12` as an example | Roadmap F33; plan 4 |
| 30 Oct | UCP `2026-04-08` cart REST | Cart declaration has only `version`, `spec` and `schema`; update is `PUT /carts/{id}` | Roadmap F15; plan 3 |
| 30 Oct | UCP releases | Newest is still `v2026-08-25`; `2026-04-08` docs unchanged | Pins hold; `2026-08-25` breaking changes recorded in Task 17 |
| 30 Oct | Google Merchant UCP (updated 19 Oct) | Implementation pages exist only for `2026-04-08`; profile still uses `signing_keys`; flags are `native_commerce(cart_eligibility)` and `native_commerce(checkout_eligibility)`, replaced as a group | Roadmap F25; plans 3 and Task 8 |
| 30 Oct | OpenAI ACP | Docs page shows `2025-09-12`; the ACP repository has released `2026-04-17`, which requires `Idempotency-Key` on every POST and integer minor-unit amounts | New finding F39; plan 4 must pin a version |
| 30 Oct | MCP | `2026-07-28` is still latest; it requires `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` headers and `_meta` fields, and removes sessions | Roadmap F23 refined; Task 5 |
| 30 Oct | Supabase and PostgREST | Role switching from the JWT `role` claim, imported ES256 signing keys, and `SECURITY DEFINER` with empty `search_path` and explicit revokes are all current | Plan 1 design confirmed |
| 30 Oct | Paystack Google Pay | Page blocks automated reads (403 and a Cloudflare challenge); secondhand copy says every `PAN_ONLY` charge gets a 3DS step-up | Unconfirmed; owner to verify by hand before Milestone C |
| 31 Oct | UCP releases | No new release; tags `v2026-04-08` and `v2026-08-25` were re-cut on 22 Oct (`v2026-04-08` → `9c9d6fce39`) | Fixtures pin the commit, not the tag |
| 31 Oct | Google Merchant UCP | Still `2026-04-08` (and `2026-01-23`) only; a `2026-04-08` cart page exists (updated 9 Oct): Google creates and transfers carts with `POST /carts` only, and update/cancel are optional sandbox tests | Task 9 scope; profile must be public and unauthenticated (F8) |
| 31 Oct | MCP | `2026-07-28` still latest; Baci's server card advertises `2025-06-18` | New finding F40 |
| 31 Oct | OpenAI ACP | `2026-04-17` still the newest release; OpenAI's page still shows `2025-09-12`; Baci advertises `2026-04-30`, which has no release | New finding F41 |
| 31 Oct | Capability gate | Paths and links cited in the access map are bound sources | Plans 3 to 6 re-review the map when they edit a path its evidence table cites |
| 31 Oct | UCP | `2026-08-25` is the latest release; Google documents only `2026-04-08` | Plan 3 stays on `2026-04-08` |
| 31 Oct | UCP `2026-04-08` overview and REST bindings | Each capability needs `version`, `spec` and `schema`; catalog is two capabilities (search and lookup) with their own spec and schema URLs | Plan 3 Task 1 (F7) |
| 31 Oct | Google Pay UCP config (updated 15 Oct) | `com.google.pay` is versioned `2026-01-23` with `merchant_info` and `allowed_payment_methods`; the PSP must process Google's tokens | Plan 3 withholds Google Pay; Task 13 |
| 31 Oct | Google cart guides (updated 9–19 Oct) | Cart transfer uses `CreateCart` only; get, update and cancel are optional in the test tool | Plan 3 keeps the create-only cart (F15) |
| 31 Oct | Google Merchant Center (updated 29 Oct) | Cart transfer is opt-out once cart is declared; checkout eligibility defaults false; the group is overwritten on each upload; US rollout only | Plan 3 owner decision; Task 8 (F25) |
| 31 Oct | OpenAI product feed | `is_eligible_search` and `is_eligible_checkout` are current; `enable_*` aliases win when both are sent; checkout needs a separately approved integration | Plan 3 Task 5 (F6) |
| 31 Oct | ACP | `2026-04-17` is still the latest; no `2026-04-30` exists | F41 unchanged (Task 5) |

## Review log

| Date | Document | Reviewer | Outcome |
| --- | --- | --- | --- |
| 30 Oct | Roadmap | Five external review rounds | All findings applied; F33–F38 added |
| 30 Oct | Plan 1 | Codex on PR #3851 (commit `faf0ddf`) | One P2: the edge inventory binds the edited agentic route files, so it must be regenerated after they are committed. Fixed in plan 1 Task 8. |
| 31 Oct | Plan 1 code | Codex on PR #3869 | Clean on `d43c97b7fc` ("Didn't find any major issues"); re-requested for the rebuilt head `ede636ee97` |
| 31 Oct | Plan 1 branch | Orchestrator | The first push rewrote commit IDs, so the capability record named a commit only this Mac had. Fixed: the push script now keeps IDs identical and stops on any mismatch. |
| 31 Oct | Plan 2 | Orchestrator | Accepted Task 1's queries and probes, the evidence table and the Production-cell rule; moved the validator and MCP fixtures under `src` for CI type-checking |
| 31 Oct | Plan 2 | Codex on PR #3851 (commit `c699994a3d`) | Didn't find any major issues |
| 31 Oct | Plan 2 code | Codex on PR #3873 | Two P1s (one primary export per file) fixed in `3778e7aaa2`; re-requested for the final head `e4eacf287a` |
| 31 Oct | Plan 2 code | Codex on PR #3873 | Clean on `e4eacf287a`; two earlier P1 threads (fixture helpers with several exports) were still open, fixed in `f119a47ba9`, threads resolved, re-requested for `1537b8d0a7` |
| 31 Oct | Plan 1 code | Codex on PR #3869 at `ede636ee97` | One P1: `merchant-context.test.ts` over 300 lines; fixed in `598f51421c`, thread resolved, re-requested for `26fc3d4011` |
| 31 Oct | Plan 3 | Codex and Jules on PR #3851 | Codex: one P2, fixed; clean at `91dfa63e86`. Jules: a naming fix, applied; then clean |
| 31 Oct | Plan 1 code | Codex on PR #3869 | Clean on `26fc3d4011` |
| 31 Oct | Plan 2 code | Codex on PR #3873 | Clean on `1537b8d0a7` |
| 31 Oct | Plan 3 code | Orchestrator | Reviewed each task's diff: the cart gate runs before every reservation, scoped client and insert in all five handlers; `route.test.ts` split to stay under 300 lines |

## Change log

| Date | Change |
| --- | --- |
| 30 Oct | Tracker created. Roadmap reviewed and restructured; plan 1 written. |
| 30 Oct | Hook PR #3858 opened: local quality gates scoped to affected packages, with full-gate fallbacks for migrations, root config and cross-workspace reads. |
| 30 Oct | Docs PR #3851 opened. First latest-docs check recorded: new finding F39, F23 and F25 refined. |
| 30 Oct | Plan 1 built (11 commits) and checked locally. |
| 31 Oct | Workflow change (owner): skip CodeRabbit when unavailable; draft PR plus `@codex review` early; keep building while reviews run. |
| 31 Oct | Plan 1 opened as draft PR #3869. Main's two failing tests were fixed by #3860; plan 1 rebuilt on top of it. |
| 31 Oct | Plan 2 written and rehearsed; published to docs PR #3851 for Codex review. New finding F42. |
| 31 Oct | Plan 2 built and opened as draft PR #3873. Read-only baseline: shared cart enrolled, VAT registered at 7.50%, migration ledger matches, public profile 200 for plain and browser requests (F8's 403 did not reproduce) with no checkout declared. |
| 31 Oct | PR branches are brought up to date by merging main in (allowed because PRs squash-merge) rather than rebasing, so no force-push is needed; the push script now replays merge commits with identical IDs. |
| 31 Oct | Plan 3 written after the latest-docs check; plans 1 and 2 synced and back in review. |
| 31 Oct | Plan 3 built (8 commits) and opened as draft PR #3884, stacked on #3873. Plans 1 and 2 are Codex-clean on their heads. |
| 31 Oct | All three code PRs synced with main by merging (no force-push): main into #3869 (`4ea8ba1280`), #3869 into #3873 (`6696156a8e`), #3873 into #3884 (`5c3c4744a4`); each register re-stamped on its merge commit (`83270eaf68`, `dded9ca801`, `bcf4117fa3`). Inventory unchanged; gates `OK`, registers `fresh`; Codex re-requested on all three. The register's `review_scope` is capped at 1000 characters. |
