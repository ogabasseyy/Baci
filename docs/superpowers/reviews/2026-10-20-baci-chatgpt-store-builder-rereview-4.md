# Baci ChatGPT Store Builder — Fourth Plan Rereview

**Date:** 20 October 2026

**Scope:** Manual rereview against local repository baseline `270fe355d8a78ddb685e3e490fcf6652fe89910e`, with fresh Supabase column-security documentation. This pass tests the private-draft claim against the existing table grants, policies and public/native consumers. No production database policy or customer data was queried.

**Disposition:** One additional P1 planning gap is verified. The [plan](../plans/2026-10-20-baci-chatgpt-store-builder.md) and [design](../specs/2026-10-20-baci-chatgpt-store-builder.md) now require a separate private draft storage boundary and a mandatory migration/compatibility proof in Task 0. This corrects the missing requirement; it does not prove that the migration/refactor works or that production has been fixed. Downstream feature work remains gated on that proof.

## R21 — P1: Published-row access defeats the private-draft promise

The previous design reused `page_configs` for private draft edits on an existing live store. That table holds both `draft_config`/draft settings and `published_config`/published settings. The baseline grants table access to anon/authenticated, and the later policy hardening still allows SELECT of a published row to both roles. An allowed row does not hide its draft columns. A client choosing only `published_config` does not prevent another caller from choosing the draft columns.

This is a source-backed defect in the proposed privacy boundary. No live disclosure or deployed-policy equivalence is claimed.

### Evidence

- `supabase/migrations/20260418000000_baseline.sql:9587–9602`: private draft and public published values share one table row.
- The same baseline, lines 16915–16917: table grants include anon/authenticated.
- `supabase/migrations/20260612061125_harden_access_helper_policies.sql:113–140`: anon and unrelated authenticated callers retain SELECT eligibility when `is_published = true`.
- `apps/web/src/app/api/builder/builder-draft-mutations.ts`: saving a draft changes the draft fields of the existing row while retaining its published fields/status.
- `apps/web/src/components/storefront/puck-storefront.tsx`: public browser loader queries `page_configs.published_config`.
- `apps/mobile-storefront/hooks/use-page-config.ts` and `lib/startup-storefront-prefetch.ts`: installed storefront clients also depend on that published-config query contract, using a client that can hold a signed-in customer session.
- `apps/web/src/lib/ai-storefront/process-storefront-layout-job.ts` and `apply_ai_storefront_draft`: legacy AI paths read/write the same draft fields, so an MCP-only storage change is insufficient for shared draft compatibility.
- [Supabase column-level security](https://supabase.com/docs/guides/database/postgres/column-level-security): row policies restrict rows; column privileges are separate, and existing table-level privileges override narrower column revocation.

### Required correction and acceptance

1. Put unpublished layout/SEO/settings in separate owner/staff-authorized `builder_page_drafts` storage. Keep candidates/history/previews private. Public compatibility rows contain approved published data and no private draft copies.
2. Task 0 must produce the tested schema/grants, private draft read/write adapters and safe public compatibility/cutover contract. Reproduce the old failure from the migration baseline, then prove raw Data API explicit-column denial for anon and another tenant. Prove owner and appropriate staff access still works.
3. Preserve public Puck and existing mobile published-config reads for guests and signed-in customers, plus browser/native-AI draft load/save/apply/CAS and launch readiness. No blanket public-endpoint revocation, privileged view, new service-role private-draft access or public draft duplication is an accepted workaround.
4. If a legacy native/AI reader cannot comply, record its prerequisite/refactor and NO-GO before Task 4. This compatibility decision must not be postponed until production release.
5. Tasks 4/9 adopt only the proven split: additive setup with flags off, concurrent-write-safe backfill, compatible reader/writer deployment, verified privacy contraction and rollback that never restores draft disclosure. Test fresh install/upgrade, unpublish/delete, direct reads and legacy writers in staging.

## Other areas rechecked

The current proxy has a bearer-request exemption and allows requests without an Origin header; no new concrete proxy blocker was verified for the fixed server-to-server gateway. The proposed gateway still must validate its token itself. Existing browser confirmation retains normal CSRF protection. Earlier review findings remain historical and were not counted again.

The revised homepage-only boundary, exact-intent confirmation preview, grant/revocation transaction rule, native publication supersession and protected-submission constraints remain intact.

## Validation boundary

Document checks cover links, fences, placeholders, whitespace, Tasks 0–9 order, ownership of the privacy/compatibility work and consistency with the private/public storage decision. No SQL migration, application code, credential, deployment, tool refresh or submission changed. Application tests, live database checks, CodeRabbit, OAuth conformance and ChatGPT host QA were not run for this documentation-only pass.

The next action remains Task 0 feasibility, now including the privacy/compatibility gate; Task 1 OAuth acceptance follows only after GO. Both existing submissions remain untouched.

## Input fingerprints

Before this pass:

```text
plan   4d65edc3cf82958005c8e1b2ab80c7f023fa9babc67b430a5b16fd93c2f5d328
design 4a72843442df6c86b25b9b630605eb47a853c3842256e7ea48ca1c851bb9b726
```
