# ChatGPT Ads Implementation Plan

Goal: merchant Pixel/CAPI setup in Baci with confirmed-payment conversions.
Spec: ../specs/2026-10-24-chatgpt-ads-design.md (approved in chat).
Execution: native in the isolated worktree, as authorized by “Approve and implement”.

Architecture: public Pixel ID in merchant feature settings; separate owner-scoped
credential table; authenticated setup API that never returns saved credentials;
ChatGPT provider adapter behind the existing durable paid-event route. User
clarification selects durable-only delivery, superseding legacy fanout support.

## Tasks

- [x] Write failing payload tests: minor units, deterministic IDs and timestamps,
  hash normalization, consent denial, no raw identifiers, provider failure safety.
- [x] Implement focused ChatGPT payload, sender, and currency modules.
- [x] Write failing pipeline integration tests using the real route resolver,
  paid-order reload, and provider adapter with mocked database/provider transport.
- [x] Add ChatGPT destination to the paid route, config/schema unions, config
  loader, and append-only destination constraint migration. Preserve existing
  canary/shadow/delivery gates and reject non-paid orders.
- [x] Add public Pixel ID plus owner RLS credential table and atomic authenticated
  settings RPC. Extend public snapshot/cache allowlists with Pixel ID only.
- [x] Test setup authentication, authorization, plan gating, secret redaction,
  blank-key preservation, disconnect, and cross-tenant rejection.
- [x] Add /dashboard/integrations/chatgpt-ads and hub card, using existing primitives.
- [x] Implement consent-aware Pixel bootstrap, attribution cookie capture, while
  keeping successful payments exclusively in the canonical server pipeline.
- [x] Add screenshot setup guidance, validate web lint/typecheck/affected tests,
  replay SQL/RLS locally if available, and run required CodeRabbit review.
- [x] Keep production migration, worker activation, provider validation,
  deployment, and campaign spending as distinct explicit outcomes.

Review focus: raw secret in broad feature projections; unpaid client events;
retry timestamp drift; declined consent; same conversion counted twice.
