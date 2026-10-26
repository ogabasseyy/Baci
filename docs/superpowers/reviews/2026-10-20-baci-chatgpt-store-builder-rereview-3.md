# Baci ChatGPT Store Builder — Third Plan Rereview

**Date:** 20 October 2026

**Scope:** Manual rereview of the revised plan/design against repository baseline `270fe355d8a78ddb685e3e490fcf6652fe89910e`. This pass focuses on the actual public page consumers, the owner confirmation experience and execution order. Earlier findings remain in the previous reports and are not counted again.

**Disposition:** Two functional planning gaps and one handoff inconsistency are corrected in the [plan](../plans/2026-10-20-baci-chatgpt-store-builder.md) and [design](../specs/2026-10-20-baci-chatgpt-store-builder.md). No additional concrete blocking design gap was verified in this pass. The plan is ready for Task 0 feasibility work; none of its runtime acceptance gates has passed merely through document review.

## Findings and disposition

| ID | Priority | Verified gap | Correction / owning tasks |
| --- | --- | --- | --- |
| R18 | P1 | Template eligibility alone did not establish page eligibility. The inputs allowed arbitrary existing-builder page slugs, but Puck loads only the homepage. About/Contact consume merchant/template fields instead, so an accepted secondary `page_configs` edit could be previewed and “published” without changing its public route. | Make v1 explicitly homepage-only: `BuilderPageSlug = 'home'`, status capability `supportedPageSlugs: ['home']`, unsupported-page rejection before queue/AI, and accurate UI/package copy. Publish exactly the approved homepage and preserve unrelated secondary drafts/public content. Retain whole-website conflict invalidation. Tasks 0/2/4/5/7/8 own consumer proof, contracts and regression assertions. Secondary-page support needs its own end-to-end consumer proof in a later slice. |
| R19 | P2 | The product required publication of the exact previewed revision, but the confirmation page specified only metadata. A model could request publication before invoking preview, leaving the owner confirming a revision identifier without seeing the proposed site; rendering the latest draft there could also misrepresent the bound intent. | Task 8 adds `loadPublishConfirmation`/`PublishConfirmationView` and displays the exact authorized, intent-bound homepage through Task 7's shared renderer. Stale snapshots require a new intent; invalid snapshots fail closed and render errors keep confirmation unavailable without consuming it. Test no prior ChatGPT preview, stale revision and rendering failure. The server still validates the bound effect; a client “viewed” flag is neither authority nor proof of human attention. |
| R20 | P3 | The final handoff said “Begin with Task 1,” contradicting the declared sequence and potentially skipping the runtime/preview GO/NO-GO gate. | Handoff now begins with Task 0. Dependency order remains Tasks 0–9. |

## Source evidence

- `apps/web/src/components/storefront/puck-storefront.tsx:105–110`: public Puck configuration explicitly selects `page_slug = 'home'`.
- `apps/web/src/schemas/builder.ts:29–31,40–50`: existing general builder schemas accept a string slug; they do not prove that a public route consumes that configuration.
- `apps/web/src/app/(storefront)/[slug]/(content)/about/page.tsx`: public About content resolves merchant `about_page` and `pages.about`, with a separate template branch.
- `apps/web/src/app/(storefront)/[slug]/(content)/contact/contact-page-content.tsx`: public Contact resolves merchant/support information and template/client content rather than a Puck page row.
- Input design's publication section required the exact previewed revision; input Task 8's confirmation step required identity/destination metadata without a bound visual preview.
- Input plan's dependency order began at Task 0 while its final execution instruction began at Task 1.

## Verification and limits

Document checks cover relative links, fenced blocks, placeholders, whitespace, task order, homepage wire/type/capability consistency, confirmation-view fields and explicit preservation of secondary content. Earlier review reports remain historical records of their input versions.

Only documentation was changed. No application code, database, credentials, deployment, tool discovery or submission was changed. No application suite, CodeRabbit review, OAuth conformance or ChatGPT host QA was run for this documentation-only pass.

The editor-free renderer/runtime proof, independent OAuth grant proof, database RLS/transaction/lock tests and real ChatGPT staging journey remain required. Begin with Task 0, then Task 1; a NO-GO stops dependent work. Both existing submissions remain protected.

## Input fingerprints

Before this pass:

```text
plan   e36b18874a0bc9db444002663392e97fffe3fc3aa2f02be2325a34e64d3ef983
design 2c9124d0e865bce26e3b539d83b2dd97984ebe4dd1e5de286221597380b08209
```
