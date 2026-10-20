# Search review round 14 — PR #3616

## Verified findings and fixes

- Refresh native comparison match condition from the stock-aware live option (fallback: normalized refreshed option/base condition). Preserve IDs and saved selection state. Web detail links with exact variant/offer IDs omit stale saved condition constraints; base links use refreshed condition.
- Add an append-only migration rejecting offsets above 1980 before candidate work in both public refined-search RPCs. This is the last start offset for 100 pages of 20 rows. NULL/negative offset behavior and bounded result size remain unchanged. Shared runtime exposes the ceiling; native stops continuation at it and web derives the existing 100-page cap from it.
- Apply shared product-search normalization to incoming assistance queries before tenant budget/model invocation. Punctuation/emoji-only queries return safe 400 responses.

## Verification

- Native comparison and refined pages: 31 passing tests, including changed variant/offer/base conditions and last-page continuation.
- Web route rejects four normalization-empty inputs before tenant/limiter/model calls. Web comparison tests verify exact option-ID links and refreshed base conditions.
- Disposable PostgreSQL 17 tests run as anon: both wrappers reject 1981 and the maximum positive integer before invoking candidate validation, accept 1980, preserve NULL/negative compatibility, and remain invoker functions. Prior private-schema/purchasability/facet regressions also pass.
- Migration replay pins include the new migration; historical migrations are unchanged.
- Full monorepo lint/typecheck and local CodeRabbit are attempted before commit. Physical-phone QA, current-head CI, and current-head external review remain separate gates.

## Deployment boundary

This work only updates the PR. No production migration or deployment was run.
