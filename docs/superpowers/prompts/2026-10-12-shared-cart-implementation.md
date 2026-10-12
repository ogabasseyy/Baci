# Implementation agent prompt: shared server cart

You are the implementation agent for Baci's shared server cart. A separate coordinator will review your work. Implement the reviewed plan through code, tests and reviewable phase commits. The user's approved product requirements are guest checkout and safe continuity across merchants, ChatGPT, web and mobile.

## Read before changing code

- Plan: `/Users/mac/.codex/worktrees/ogabassey-cart-release/Baci-app/docs/superpowers/plans/2026-10-11-shared-server-cart.md`
- Research/spec: `/Users/mac/.codex/worktrees/ogabassey-cart-release/Baci-app/docs/superpowers/specs/2026-10-11-shared-server-cart-design.md`
- Completed independent plan review: `/Users/mac/.codex/logs/ogabassey-verified-facts/shared-cart-plan-review/latest-luna-review.md`
- Current root and app-level AGENTS.md, `apps/web/CLAUDE.md`, relevant package manifests/configuration, and `docs/agent-guidance/validation.md` when present.

The plan/spec are currently uncommitted in the release checkout. Copy them into your own implementation worktree so they travel with the work; preserve the originals. The review confirms planning coverage, not that role feasibility, migrations, tests or production behavior have passed.

## Ownership and execution

1. Inspect branch/worktree ownership and current main. Create or reuse your own isolated branch with the `codex/` prefix; `codex/shared-server-cart` is the proposed name. Do not implement in the detached release checkout or take over another agent's worktree. You are not alone in the repository: preserve unrelated edits and adjust to reviewed changes from others.
2. Refresh integration paths against current main. Record the baseline commit and relevant existing failures. Follow the plan's order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 11A → 8 → 9 → 10 → 11B → 12 → 13 → 14.
3. Keep phases reviewable. Record an implementation progress document in your worktree containing task status, decisions, source references, test evidence and review handoffs. Check off tasks only after their verification passes. Document necessary deviations and their effect on the plan.
4. Proceed autonomously on authorized local implementation. Complete concrete preparation before asking about a restricted operation. A failed authorization/protocol proof blocks dependent activation; report the exact failure and continue useful independent work. Never bypass the gate to make tests pass.

## TDD and current 2026 guidance

- For each new runtime behavior or bug fix, write a meaningful colocated regression test first, run it and record the expected behavioral failure. Implement the smallest coherent change, obtain a pass, then refactor while retaining coverage. A syntax error or missing test runner is not the required RED evidence. Do not write tests that only repeat implementation details.
- Run concurrency, transactions, RLS and grants against an isolated local PostgreSQL/Supabase environment with real roles and separate sessions. Mock external services deterministically; JavaScript mocks alone cannot prove tenant isolation or transaction correctness.
- Consult primary official documentation current as of 12 October 2026 for Supabase signing/RLS/Realtime, the installed Next.js/React/Expo/MCP versions, Shopify cart lessons and the exact negotiated UCP version. Record relevant URLs, versions and decisions. Resolve conflicts against actual repository configuration; do not upgrade major dependencies merely to claim “latest patterns,” copy unsupported examples or invent platform capabilities.
- Use the repository's pnpm/Turborepo/Biome toolchain. Preserve strict TypeScript, explicit Supabase column selection, React Compiler policy and existing shared/platform abstractions. Do not add manual React memoization or introduce a second synchronization framework.

## Required behavior and failure cases

- Guests can add, remove, hand off and reach checkout without an account. Saving details, authenticated account linking, marketing consent and purchase consent are distinct. An email address or ChatGPT account does not establish merchant-customer identity.
- Enforce merchant/cart/grant matching in the database and transport adapters. Test two merchants and two guests, same-host merchant tabs, custom domains, forged identity, expired/revoked proofs and logout/account switching. No service-role/admin shopper operation or broad role fallback.
- Implement pre-cart creation receipts, stable operation keys, atomic replay/version handling and safe response-loss reconciliation. A retry never duplicates quantity, restores a removed line, replaces newer state with an older snapshot or creates a new cart because storage is unavailable.
- Preserve variant/condition/options identity, quantity limits, negotiation, vouchers and checkout generation. Removal and reduction work despite an unavailable product or catalog outage. Emptying an ordinary shared cart retains its identity. Accurate tool annotations remain required; do not promise to eliminate host confirmation prompts.
- Fence legacy writers before migration; one migrated cart has one authoritative writer. Extend MCP contracts with explicit version/key/line identities and refresh behavior. Do not silently supply a newer version on behalf of an old stale request.
- Follow the plan's handoff/merge grant rules, preview-safe GET, intentional POST, destination attempt proof, bounded secrets and replay recovery. Never silently discard existing items or broaden another principal's permissions.
- Web/mobile use optimistic display over authoritative state, serialized commands, version/generation reconciliation, private minimal notifications and foreground recovery. Previous ChatGPT messages are not live cart views. Verify active-widget behavior separately against supported host APIs.
- Bind the reviewed cart/version to the final order transaction and one checkout generation. Test removal versus submission, distinct order keys, pending-payment recovery, transaction rollback and native queued replay. Ordinary cart grants gain no payment/order authority.
- Keep Google basket transfer distinct from ongoing linked cart synchronization. Pin exact supported schemas; protect replacement, cancel and checkout after shared ownership. Protocol conformance/enrollment must not be inferred from local fixtures.
- Preserve public catalog rendering/cache/SEO. Private cart/handoff data is nonpublic and excluded from shared caches. Qualify performance, bounded retention, outbox recovery, metrics and rollback according to the plan.

## Validation and review handoff

Run focused checks while developing, then the required cross-package/full-monorepo gate because shared runtime and several consumers change. Include SQL replay/real-role tests, browser checkout tests and native checks using current repository commands. Report pre-existing failures, skipped checks and unavailable tools separately.

Before committing code, run `coderabbit review --agent -t uncommitted` in your worktree and address valid required findings. An unavailable reviewer leaves that gate incomplete. Stage only task-owned paths. Rebase/commit changes invalidate earlier SHA-specific review/CI evidence.

At each phase, give the coordinator a review packet:

- Worktree, branch, exact commit SHA or uncommitted diff, and completed plan tasks.
- Concrete before/after behavior and changed contracts/migrations/grants.
- RED and GREEN test evidence, commands, relevant baseline failures and incomplete gates.
- Failure cases covered, deviations, remaining risks and proposed next phase.

Continue independent next-phase work while review is underway; address valid findings before dependent work is treated as accepted. Do not claim the coordinator reviewed a revision until its feedback actually arrives. Do not merge or deploy without the user's applicable authorization. This prompt itself does not authorize messaging another Codex chat; return the review packet to the user unless they explicitly authorize sending it to a specific chat.

## Operational boundaries

Implement and test locally. Append migrations; never rewrite historical migrations. Do not edit `.env*`, `apps/web/src/proxy.ts` or `apps/web/src/config/business-types.ts` without the repository-required explicit authorization. Prepare exact proposed diffs for review if needed. Keep all credentials private. New production roles, keys, migrations, enrollment and releases require their applicable authorization; historical release exceptions do not transfer automatically.

No live order, payment or shipment during QA. Protect pre-existing customer carts and use isolated fixtures. Production release remains gated by the current approved VPS flow, reviewer feedback, exact release evidence and owner authorization. A merge or passing CI alone is not production verification.

Start now with the current-main baseline and Tasks 1–2. Continue through the dependency sequence, producing the review packets and satisfying the gates above.
