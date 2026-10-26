# Baci ChatGPT Store Builder — Plan Rereview

**Date:** 20 October 2026

**Scope:** Manual review of the implementation plan/design against repository baseline `270fe355d8a78ddb685e3e490fcf6652fe89910e` and freshly retrieved OpenAI authentication/UI guidance. Findings describe defects in the proposed plan, not demonstrated production incidents.

**Verdict:** The verified plan defects below are corrected in the [implementation plan](../plans/2026-10-20-baci-chatgpt-store-builder.md) and [design](../specs/2026-10-20-baci-chatgpt-store-builder.md). Ready to start the gated feasibility work; not evidence that implementation, OAuth conformance or a production release is complete.

## Findings and disposition

| ID | Priority | Verified gap in the previous plan | Evidence / correction |
| --- | --- | --- | --- |
| R1 | P1 | Standalone Node transport was expected to call services that depend on the Next.js request/cache runtime. A successful bundle would not prove those services work in a standalone process. | `src/lib/storefront-publication-cache-eviction.ts` invokes cache revalidation; `src/lib/cache-revalidation.ts` imports `next/cache` and `after()`. Added a fixed Baci Next.js execution gateway, strict runtime separation and a real-runtime proof in Task 0. Tasks 6/8/9 include both web and MCP artifacts. |
| R2 | P1 | Reusing `ai_jobs`/the current storefront dispatcher could route new user-facing builder work through a service-role client, contrary to the plan's own boundary. The old plan left this to a later suitability decision. | `src/scripts/process-ai-storefront-jobs.ts:65-72` explicitly creates that client. Task 5 now uses a separate RLS operation table, a linked-user runner and fixed Baci execution route; only AI computation/validation is reused. No global application-table credential is permitted. |
| R3 | P1 | Website-version protection did not specify how legacy browser/AI writes and changes to another page invalidate a preview. Updating only the new services leaves lost-update and publish races. | `src/app/api/builder/builder-draft-mutations.ts` and `src/app/api/ai-jobs/[id]/apply/route.ts` are independent writers; the latter invokes `apply_ai_storefront_draft`. Task 4 requires a writer inventory, database revision maintenance, one lock order, staff/browser compatibility and multi-page race tests. Publication approves the complete frozen changed-page set. |
| R4 | P1 | Generic OAuth metadata/401 tests omitted the per-tool metadata and error metadata that trigger ChatGPT linking. The server could pass protocol tests but never present a usable sign-in flow. | Current [OpenAI auth guidance](https://developers.openai.com/plugins/build/auth#triggering-authentication-ui) requires both `securitySchemes` and `_meta['mcp/www_authenticate']`. Tasks 2/6 now pin both, including cold, expired and insufficient-scope flows. |
| R5 | P1 | A cached mutation result could stay `approval_required`/`verifying` forever, and the status contract had no explicit publication recovery/supersession behavior. HTTP 200 or a receipt endpoint also cannot prove client-rendered storefront content is live. | Tasks 2/8 define current receipt-state lookup, effect uniqueness across different request keys, owner retry after session expiry and terminal `superseded`. Task 0 inventories public consumers; Task 8 binds the public marker to the loaded render snapshot and verifies it with a bounded read-only browser probe. No privileged global outbox drain is introduced. |
| R6 | P2 | A connection consented with an empty store allowlist could create a store and immediately be denied its next status/edit call. Blindly incrementing the grant version could also invalidate the current token. | Tasks 3/4 now atomically materialize the pre-consented single-store target without widening authority or changing the grant version for that binding. A create-to-edit test is mandatory. Real permission changes still require reauthorization. |
| R7 | P2 | Multi-owned-store behavior was assumed despite the current account/schema contract. | Baseline migration `20260418000000_baseline.sql:11299` defines `merchants_user_id_key UNIQUE (user_id)`; onboarding uses `maybeSingle()` by owner. No later drop was found. V1 preserves zero/one owned store and returns `STORE_ALREADY_EXISTS` for established-store creation. Multiple owned stores are explicitly deferred. |
| R8 | P2 | The existing inert preview was described as a portable, exact renderer, but it imports the editor config/Next dependencies and substitutes fake merchant/products. The new nested widget package would also miss current workspace inclusion. | `components/builder/config.tsx` imports Next APIs/editor fields; `render-builder-config.tsx` creates preview identity and swaps ProductGrid; `preview-product-grid.tsx` renders sample data. Task 0 now proves an editor-free six-block renderer, real identity/catalog projection, CSS parity and size limits. Task 7 adds workspace/CI wiring and labels demo/empty data. |
| R9 | P2 | Reusing Muse request audit could lose mutation/approval evidence under saturation. | `tools/connector-gateway/audit.ts` explicitly drops records when busy or on failure. Tasks 4/8 require redacted mutation evidence in the business transaction and rollback on audit failure. Request telemetry remains best effort. |
| R10 | P2 | SEO editing was promised without an identified schema/AI operation or public metadata consumer; persistence alone could report success without customer-visible output. | The inspected `draft_seo`/`published_seo` references are builder persistence/load and types, not a demonstrated public SEO producer-to-consumer path. V1 preserves those fields and defers SEO/global-settings edits. Copy/layout/theme changes remain included. |
| R11 | P2 | The provider spike needed dependencies to prove acceptance, while the plan prohibited changing dependency manifests until acceptance; Task 6 also expected all eight tools before later tasks implemented two of them. | Task 1 now permits pinned disposable-worktree candidate dependencies; only accepted dependencies proceed to production configuration. Task 6 tests six implemented tools, Task 7 adds preview and Task 8 adds publication, then the final inventory asserts eight. |

## Remaining gates, not completed claims

1. **Runtime/preview GO:** prove editor-free presentation, actual Next cache execution, public snapshot/version visibility and bundle budget in Task 0.
2. **OAuth GO:** prove the chosen provider's PKCE, resource/audience binding, registration, refresh/revocation and restart behavior; no fallback to ordinary Supabase-token exposure.
3. **RLS/transaction proof:** run disposable-database ownership, role/grant, concurrency, lease, idempotency and publication receipt/outbox tests.
4. **Host QA:** a real ChatGPT connection and staging new-owner/existing-store journey must pass, including browser confirmation and public rendering verification.
5. **Release authority:** web/MCP/auth deployment, provisioning and a new plugin submission remain separate future steps. Both existing submissions remain protected.

## Verification performed during this rereview

- Read the plan and design in full; checked the current local source and migration constraints for each code-backed finding.
- Re-fetched official OpenAI authentication and UI documentation and checked the linking requirements.
- Rechecked document references, whitespace, task sequence and contract consistency after corrections.
- No application code, environment, database, deployment or submission was changed. No application test suite, provider conformance suite, CodeRabbit review or host QA was run for this documentation-only rereview.

### Input document fingerprints

Before this rereview's edits:

```text
plan   2b96d19a1470dcc82236366fe08800c17f7df320a3554c224cc3c87ade86e014
design 6de060893831b890aa3dddba20ac6ec298f8545673cebd958cc7c516cfe3dbd2
```
