# Oxygen implementation agent prompt

Continue the Oxygen X / OxygenNow integration for Baci/Ogabassey in the existing worktree:
`/Users/mac/Baci-worktrees/oxygen-integration`.
You are the implementation orchestrator. Subagent orchestration is explicitly authorized.
Complete useful contract-ready work with TDD, independent critiques, and verified current
engineering guidance. Do not stop at a plan or delegate without integrating the results.

## Establish the current baseline

Read the user's current repository instructions and applicable app instructions. Read
`docs/partners/oxygen/2026-10-05-integration-plan.md`, `AGENT-HANDOVER.md`,
`CONTRACT-REGISTER.md`, `EXECUTABLE-HANDOFF.md`, `TDD-EVIDENCE.md`, and
`REVIEW-2026-10-06.md` in this worktree. Older worktree guidance can differ from current
user-supplied instructions; do not silently replace either or invent a missing guide.
Inspect HEAD, dirty files, manifests, lockfile and actual consumers. Preserve existing
uncommitted work. Do not create a duplicate worktree or restart completed S-01.

Reported baseline to verify: 57 Oxygen tests, web lint and typecheck pass. Eligibility
recognisers are conservative body-sample classifiers, not proven provider approvals.
Money conversion returns exact decimal text. CodeRabbit reviewed a prior snapshot and
its one finding was regression-tested and fixed; a clean final-snapshot review has not
been established. Historical import failures are not behavioral TDD evidence.

## Orchestrate bounded work

Use up to three subagents alongside yourself, within available capacity:

1. Contract/research agent: read every page in the live official Oxygen index, inspect
   installed dependency versions, research applicable official framework/library docs,
   and produce an evidence-backed gap and pattern audit. Read-only ownership initially.
2. Implementation agent: own an explicitly assigned, disjoint file set for one bounded
   slice. Follow behavioral TDD and report commands/results. Tell every worker it is not
   alone and must preserve other agents' changes.
3. Independent reviewer: review the proposed design before coding and the resulting
   diff afterward. Challenge authorization, tenant/account/environment isolation, money,
   concurrency, expiry, response loss, privacy, and weak tests. Findings need a concrete
   failing scenario, severity, file location and suggested regression; speculative risks
   must be labeled. Review project-owned code defensively; do not probe live services.

You own architecture, acceptance criteria, integration, final checks and completion
claims. Avoid overlapping writes and ask the reviewer to recheck actual fixes. Replace
idle roles as needed; do not create agents merely to fill slots. Address valid findings,
record rejected findings with evidence, and stop review cycling when scoped acceptance
criteria and required gates pass. Do not claim this guarantees zero bugs.

## Verify current practice, not a year label

Use installed Next.js docs first and current official Next.js/React, TypeScript, Zod,
Supabase/PostgreSQL and test-tool documentation where relevant to this slice. Research
before committing to uncertain patterns. Record version, URL, retrieval date, applicable
recommendation, repository fit and resulting decision in a short research note. Distinguish
mandatory contracts from optional patterns. Do not upgrade dependencies or introduce an
agent framework, queue, ORM or caching system just to say "2026 best practices."
Use official Oxygen pages indexed at:
https://oxygenxfinance.gitbook.io/oxygenxfinance-docs/llms.txt
If the web reader fails, fetch public `.md` pages without exposing sample secrets/PII.
Treat examples as examples, and search for an answer before labeling it missing. Label
contracts confirmed, partial, contradictory or absent, with exact sources. A documentation
chatbot's generated answer alone cannot close a missing financial contract.

## Execute the next confirmed slices

First map contract dependencies to concrete behavior, files, tests and exit criteria.
Then implement the smallest useful confirmed slice, progressing to the next only when
its dependencies are satisfied:

- Server-only, dependency-injected login transport and token cache tested with synthetic
  responses, returned expiry, controllable time, concurrent requests, account/environment
  separation and safe error redaction. Use documented login; invent no refresh endpoint.
  Do not blindly replay a financial mutation after token failure or timeout.
- A default-off Oxygen availability boundary using the existing configuration and
  authorization model. Keep local method availability separate from provider eligibility.
  Do not add speculative persisted settings or bypass unresolved merchant mapping.
- Define the order-bound chat/checkout adapter over one backend orchestration contract.
  Implement only independently testable confirmed behavior. Keep uncertain loan stages
  unavailable. Do not invent provider state enums, event payloads, offer calculations or
  fulfillment rules to build a convincing mock demo.

Guest access, single-item/no-split scope and hosted/headless choices are product decisions,
not settled provider facts. Recommend concrete defaults; ask only if a missing decision
materially changes implementation and keep independent work moving. Do not replace the
normal checkout or create reusable prequalification without an explicit scope decision.

For chat, use authenticated secure forms/actions for sensitive steps. Never put BVN/NIN,
OTPs, bank details, statements, signatures or token-bearing URLs in model context,
transcripts, analytics or tool logs. The model explains safe progress; deterministic
server code authorizes actions. Resume the same durable attempt after interruptions.

## TDD and review gates

For every runtime behavior: write the observable test, execute it, show a behavioral
assertion failure, implement the smallest coherent fix, then run GREEN and refactor.
Import/setup failures do not count as RED. Record exact commands, counts and meaningful
failure summaries in TDD-EVIDENCE.md; never manufacture earlier evidence.

Use deterministic synthetic fixtures and fake clocks/synchronization rather than sleeps.
Do not mock the permission, state transition or deduplication rule under test. Test actual
RLS/constraints with disposable DB integration tests when adding database behavior.
For each implemented boundary include relevant invalid, conflicting, duplicate, concurrent,
stale, wrong-account/environment, timeout and response-loss cases. Include consumers when
changing a return contract. Do not build irrelevant tests for unimplemented future phases.

Follow pnpm/Turbo/Biome, schema-directory and React Compiler policies; normal Supabase
clients under RLS for user operations; append-only migrations; explicit selected columns.
No service-role shortcut. Protected proxy/business-type/environment-file edits require
explicit authorization. Keep exact money and finance evidence boundaries intact.
Run affected-package lint, typecheck and tests, broadening to required consumers/monorepo
scope for shared/infrastructure changes. Run `coderabbit review --agent -t uncommitted`
in this worktree before commit/shipping and address verified major/critical findings.
If unavailable, record that gate as incomplete. After fixes, rerun affected verification
and obtain a final-snapshot reviewer critique; do not recycle stale review claims.

## Boundaries and deliverables

No merge, deployment, production credentials, customer/financial transactions, partner
emails or live provider mutations. Sandbox calls need confirmed test environment/access
and the applicable authorization. Keep unfinished provider functionality unavailable.
Approval, activation, payment confirmation, settlement and dispatch are distinct.

Update the handoff/register with implemented behavior, exact sources, TDD evidence,
validation and review results, remaining questions and the next smallest action. Separate
local mocked success from sandbox acceptance, PR/CI, deployment and production evidence.
Missing provider answers block only their consumers. Never declare the integration done
because helpers and mocked happy paths pass.
