# Agentic Commerce Program Tracker

The single place to see where the agentic commerce work stands and what happens next. Update it whenever a step finishes: tick the box, add the date, and add the PR link or commit.

- **Roadmap:** [2026-10-29-agentic-ucp-completion.md](2026-10-29-agentic-ucp-completion.md). It holds the findings (F1–F38), the milestones and the tasks.
- **Plans:** one executable plan per pull request, saved as `2026-MM-DD-agentic-m<milestone>-<n>-<name>.md` in this folder.

## Now

| | |
| --- | --- |
| **Current plan** | Milestone 0, plan 1: remove the admin client from agentic routes |
| **Next action** | Independent review of plan 1, then the TDD build |
| **Waiting on the owner** | Merge of docs PR [ogabasseyy/Baci#3851](https://github.com/ogabasseyy/Baci/pull/3851) after its gates pass |
| **Last updated** | 30 October 2026 |

## How every plan moves (the loop)

Each plan goes through these steps in order. A step is done only with evidence: a link, a commit, test output or a dated note.

1. **Latest-docs check.** Before writing or building, check the current specs and library docs the plan depends on (see "Latest-docs rule"). Record the result in the docs log below. If something changed, add a finding to the roadmap first.
2. **Write the plan.** Use exact files, complete code, exact commands, and TDD steps.
3. **Independent review.** A reviewer that did not write the plan checks it. Apply the valid findings and record each review round.
4. **Build with TDD.** One fresh worker per plan task: write the failing test, run it red, write the code, run it green, then commit. The orchestrator reviews each task's diff before the next starts. A task without red-then-green evidence is not done.
5. **Local gates.** Affected tests, typecheck, lint, the capability gate when cited files change, and `coderabbit review --agent -t uncommitted` before every commit.
6. **Pull request.** Push and open the PR only with the owner's go-ahead.
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

- [ ] Latest-docs check (protocol docs checked 30 Oct and unaffected; Supabase JWT-role and PostgREST role-switching docs still to check)
- [x] Plan written (30 Oct; SQL proven in a throwaway Postgres; all 45 replacement snippets match main `1a17a9b900`)
- [ ] Independent review, fixes applied
- [ ] Built with TDD (plan tasks 1–10)
- [ ] Local gates passed
- [ ] PR opened (owner OK):
- [ ] PR gates green
- [ ] Merged (owner OK, deploys)
- [ ] Production check: payment-split function live, `anon` cannot execute it

### Plan 2: baseline and evidence (roadmap Task 1)

- [ ] Latest-docs check
- [ ] Plan written. Needs an owner-approved, read-only production check of whether `shared_cart_enabled` and VAT are on for the agentic merchant.
- [ ] Independent review, fixes applied
- [ ] Built with TDD
- [ ] Local gates passed
- [ ] PR opened (owner OK):
- [ ] PR gates green
- [ ] Merged (owner OK, deploys)
- [ ] Production check

### Plan 3: truthful capability claims and the shared-cart gate (roadmap Task 3)

- [ ] Latest-docs check (UCP profile and capability fields, Google cart rules, OpenAI feed flags)
- [ ] Plan written
- [ ] Independent review, fixes applied
- [ ] Built with TDD
- [ ] Local gates passed
- [ ] PR opened (owner OK):
- [ ] PR gates green
- [ ] Merged (owner OK, deploys)
- [ ] Production check

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
| Approve read-only production queries for plan 2's baseline (shared cart and VAT state) | Plan 2 | Open |
| If the agentic merchant charges VAT: block its agentic completion until roadmap Task 6, or pull tax parity into Milestone 0 | Plan 5 | Waiting on plan 2's answer |
| Free space in Docker Desktop (its own disk is full; tests currently run the database in memory instead) | Convenience | Open |
| Verify Paystack's Google Pay page by hand: it blocks automated reads, so the 3DS and `PAN_ONLY` details are unconfirmed | Milestone C | Open |
| Partner access: Google UCP sandbox, OpenAI commerce approval, Paystack token and 3DS support | Milestones B–C | Open |

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
| 30 Oct | Paystack Google Pay | Page blocks automated reads (403 and a Cloudflare challenge); secondhand copy says every `PAN_ONLY` charge gets a 3DS step-up | Unconfirmed; owner to verify by hand before Milestone C |

## Review log

| Date | Document | Reviewer | Outcome |
| --- | --- | --- | --- |
| 30 Oct | Roadmap | Five external review rounds | All findings applied; F33–F38 added |
| 30 Oct | Plan 1 | Codex on PR #3851 (commit `faf0ddf`) | One P2: the edge inventory binds the edited agentic route files, so it must be regenerated after they are committed. Fixed in plan 1 Task 8. |

## Change log

| Date | Change |
| --- | --- |
| 30 Oct | Tracker created. Roadmap reviewed and restructured; plan 1 written. |
| 30 Oct | Docs PR #3851 opened. First latest-docs check recorded: new finding F39, F23 and F25 refined. |
