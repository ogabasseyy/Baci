# Checkout payment orchestration follow-up

## Scope

Continue from merged PR #3499 (`a00fc7481a`) on
`codex/checkout-payment-orchestration`. Deliver one focused PR separating order
submission/reuse and provider transitions from the checkout page, with the
existing payment, retry and monetary contracts preserved.

The dirty primary checkout remains untouched. API/database authorization
migration, provider settlement, production deployment and bundle optimization
remain separate work. This extraction does not certify the whole checkout.

## Contracts to preserve

| Boundary | Required behavior | Existing or added evidence |
| --- | --- | --- |
| Order identity | Preserve a durable idempotency key across an interrupted response; reuse the pending order after returning from payment | `checkout-idempotency.test.ts`, `pending-checkout-order.test.ts`, `interrupted-order.pw.ts`, `recovery.pw.ts` |
| Submission lock | Reject simultaneous clicks; allow explicit recovery when a modal closes or a frozen document returns | Browser duplicate-click test, `use-payment-return-reset.test.ts`, focused provider tests |
| Canonical money | Use server order currency, total and remaining gateway amount; zero-due alone does not prove payment | `checkout-page.submission-*.test.tsx` and partial-credit provider suites |
| REDVAULT | Keep indeterminate/live orders fenced; cancel only through the existing checked operation; preserve guest attachment and held states | Existing prepared-order/fence tests and `checkout-page.bank-transfer-*.test.tsx` |
| BNPL | Record a start only after a popup/widget actually opens; Credit Direct completion goes to server verification; pending CredPal is not paid | `checkout-page.bnpl-*.test.tsx`, `checkout-page.resume-*.test.tsx` |
| Bank transfer and crypto | Preserve pending identity, stamped currency and total; only server verification confirms payment | DVA/crypto hooks and page integration suites |
| Invoice, Pay for Me and POD | Preserve success URLs, tracking tokens and cleanup timing; invoice delivery is confirmed downstream | Completion handler tests and existing zero-due invoice suite |

## Current guidance

Checkout mutations stay in user-event handlers. Shared processing is extracted
into typed functions rather than a chain of effects that could replay on a
render. This follows [React's event/effect guidance](https://react.dev/learn/separating-events-from-effects)
and [shared event logic guidance](https://react.dev/learn/you-might-not-need-an-effect).

Extracting modules does not itself reduce downloaded JavaScript. Conditional
loading requires a measured separate change under [Next.js lazy-loading guidance](https://nextjs.org/docs/app/guides/lazy-loading).
No performance improvement is claimed from line-count reduction.

## Production observation: 25 September 2026

The production jobs following both #3497 and #3499 failed. For #3499,
[run 36139575878](https://github.com/ogabasseyy/Baci/actions/runs/36139575878)
stopped in the database predeploy phase at
`20260921100200_enforce_merchant_shipping_provider_policy.sql` with
`audit_actor_required` from the merchant-feature-settings audit trigger. This
prevents that workflow from shipping the merged checkout changes.

The already-open live checkout at 1440px rendered the summary but hid its order
action (`display: none`). Reloading made the action visible, while its DOM still
used the old `hidden lg:flex` classes, rather than the merged `max-lg:hidden`
fix. This is consistent with the original CSS ordering failure still being
possible in the deployed version. The temporary viewport override was reset.
No live order or payment was submitted. Fixing the migration and deploying
through the approved VPS flow are still release prerequisites.

## Verification record

- Before extraction, the new interrupted-response browser characterization
  passed in Chromium and WebKit for guest and authenticated-session fixtures
  (4 cases). WebKit can log one expected fetch failure as the old document
  unloads; only that exact console message is permitted for these cases.
- Final source, browser, lint, typecheck, CodeRabbit and PR-head review results
  are recorded in the follow-up PR. Mocked endpoints do not establish real
  authentication, tenant isolation, provider settlement or reconciliation.

## Source inventory after squash/rebase

The checked-in Task 1A file is a regression snapshot. CI validates its self-hash
and compares every policy, row, hostname and source-content digest against a
fresh inventory generated from local committed HEAD. Only the historical
`originMainSha` and the digest that includes it differ during comparison. The
original digest is verified separately; historical identity is not certified.

The existing source-authority reader still rejects dirty files, added/deleted
routes, symlinks and byte mismatches. The six extracted runtime handlers remain
in the inventory input list. CI no longer fetches a discarded branch commit to
validate a checked-in snapshot. A fresh-clone regression covers an actual squash
whose original source object is unavailable.

Operational evidence creation and `validateStorefrontEdgeInventory` retain the
exact independently supplied source-SHA contract. Such evidence must be
regenerated from the intended committed source; repository snapshot validation
cannot substitute for provenance or release approval. This separation removes
the need for a corrective receipt-only PR after every squash merge while
preserving the repository's linear-history policy.

[GitHub documents that squash/rebase rewrites commit identities](https://docs.github.com/en/pull-requests/reference/pull-request-merges).
The distinction between artifact digests and source provenance is consistent
with [SLSA's provenance model](https://slsa.dev/spec/v1.1/provenance); this change
does not claim SLSA certification.

## Next checkout work

1. Repair the independent database predeploy failure, then deploy through the
   approved VPS flow when authorized and verify desktop/mobile checkout live.
2. Exercise real staging payment initiation, cancellation, return, timeout and
   reconciliation with the appropriate provider test accounts.
3. Extract the remaining form, address/shipping and REDVAULT coordination in
   focused increments with behavior tests. The page is still 2,955 lines.
4. Measure checkout JavaScript, interaction latency and request waterfalls;
   optimize confirmed costs and compare matching before/after traces.
