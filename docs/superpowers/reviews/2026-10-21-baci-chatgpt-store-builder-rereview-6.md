# Baci ChatGPT Store Builder — Sixth Plan Rereview

**Date:** 21 October 2026

**Scope:** Manual review of the revised plan/design against repository baseline `270fe355d8a78ddb685e3e490fcf6652fe89910e`. Focus: interactions among the private draft split, deferred SEO/settings scope, exact approval and the existing publication helper. The baseline did not change during this review. No production state was inspected.

**Disposition:** One P1 publication-scope gap is corrected in the [plan](../plans/2026-10-20-baci-chatgpt-store-builder.md) and [design](../specs/2026-10-20-baci-chatgpt-store-builder.md). The correction is a documented implementation/acceptance requirement; no runtime fix is claimed.

## R23 — P1: Do not publish pending SEO/settings with a homepage-only approval

The plan defers SEO/global-settings editing and promises to preserve existing settings, but its publication task referred broadly to the homepage's “published fields” and the spec said settings/SEO were “copied.” It did not distinguish the current published values from separately pending native draft values.

`apps/web/src/app/api/builder/builder-draft-mutations.ts` implements `publishBuilderDraft` by assigning:

- `published_config` from `draft_config`;
- `published_seo` from `draft_seo`;
- `published_store_settings` from `draft_store_settings`;
- `published_setup_settings` from `draft_setup_settings`.

Therefore reusing that publisher unchanged could release a merchant's pending SEO/checkout/setup changes during a homepage layout approval, even though the plugin neither supports nor previews those changes. R18 already protects secondary pages; this finding concerns other fields on the same homepage row. R10 deferred SEO editing but did not previously pin publication preservation at the field level.

### Correction / acceptance

- The builder publication entry point has a fixed field allowlist for the approved homepage layout config, necessary publication metadata/revisions and required visibility. It writes no `published_seo`, `published_store_settings` or `published_setup_settings`.
- Preserve both existing published side fields and separately pending private SEO/settings. Full old-state history remains atomic; preserving history does not authorize promoting the pending values.
- Task 8 tests a valid approval with deliberately different live and pending side fields. After publication only the approved layout/publication effect changes; all side fields and pending private drafts remain byte-for-byte unchanged.
- Include null/default values and first publication of a new store. Prove existing storefront defaults or return the real setup/readiness blocker; do not resolve it by silently publishing pending settings.
- No model-selected field mask or unconditional use of the broad native publisher is permitted. Ordinary Baci browser publication keeps its authorized field scope. The confirmation action accurately describes homepage layout/copy/theme changes.

## Rechecked constraints

The canonical grant/revocation checks, committed-receipt-first retry ordering, homepage-only consumer proof, private draft migration/compatibility gate and both protected submission identities remain intact. A possible first-publish readiness cycle was checked and not verified: the merchant publish route uses `loadStoreLaunchReadiness`, whose required facts do not depend on an already-published homepage; full dashboard readiness is a separate loader. Task 0 feasibility and Task 1 OAuth acceptance are still mandatory and unexecuted. A plan review is not evidence that database privacy, publication or host integration works.

## Validation boundary

Document checks cover links, fences, placeholders, whitespace, Tasks 0–9 order, consistency of the field-preservation rule and ownership of regression coverage in Task 8. Only documentation changed; no application code, schema, credentials, deployment, tool refresh or submission changed. No application suite, SQL acceptance test, CodeRabbit review, OAuth conformance or ChatGPT staging test was run.

## Input fingerprints

Before this pass:

```text
plan   1f42f8af1a7a85f670a83816f5795b720d02fc6f59eb5b7d7c01fce987b7cf5e
design d2e303cba0c4bea0135ad4daa6832f8884640ab47d915ea3e8666a068025a6a6
```
