# Baci builder Task 0 feasibility acceptance

Date: 2026-10-21. Inspected source baseline:
`270fe355d8a78ddb685e3e490fcf6652fe89910e`.
Worktree: `codex/baci-builder-feasibility`.

## Result: bounded architecture feasibility passed

The two original blockers now have implemented and tested solutions: an
editor-free shared preview capability, and normal-user private draft lifecycle
adapters. The full migration history/current-tree replay and real membership
checks passed locally. **This is a feasibility result, not production activation,
a completed ChatGPT integration or release approval.** Neither existing submission
was opened, edited, refreshed, cancelled, resubmitted or deployed.

Only the explicit Puck capability `baci-home-six-v1` is certified. The old Puck
sample preview is preserved for compatibility and is not claimed to be exact or
portable. Existing stores are not silently migrated. Future generation, save and
publish services must require the certified capability or refuse the operation.

| Gate | Evidence | Result |
| --- | --- | --- |
| Portable initialized widget | Shared six-block renderer; no Next/editor/Supabase dependency | PASS |
| Bundle limits | 544,858 bytes raw HTML; 133,306 bytes gzip | PASS: below 3 MiB / 1 MiB |
| Actual merchant/catalog projection | Explicit Puck merchant, tenant-bound validated products, captured timestamp; empty/demo labeling | PASS |
| Public/widget parity | Exact PNG bytes plus geometry/styles at 375/768/1200; real compiled public globals CSS | PASS |
| Template/URL rejection | Actual `merchant.template_id`; unknown explicit renderer versions, external/normalized/traversal links refuse | PASS |
| Real runtime/cache | Loopback HTTPS to Next 16.3.8 Node route calling real publication-cache function | PASS |
| Public config/version rendering | Actual public adapter in Next browser, two client-loaded revisions, coherent immutable config/version marker | PASS |
| Complete database reconstruction | Repository frozen history plus current-tree sources; pinned tools; schema effect comparison converged | PASS |
| Private storage with real membership | PostgreSQL/PostgREST; actual owner/edit/view/non-builder/suspended staff and unrelated/anonymous callers | PASS |
| Draft lifecycle | Load/save, owner/staff CAS, native snapshot/enqueue/apply, browser/narrow publish, rename, onboarding, deletion | PASS |
| History/candidate and worker isolation | Raw API isolation; history failure rolls back publication; service role denied new table/apply | PASS |
| Cutover races | Real lock/writer test; concurrent CAS; newer existing private draft preserved | PASS within documented mechanism scope |
| Rollback contract | Public query stays compatible; private adapters remain usable; unadapted legacy draft query fails closed | PASS for local contract; no deployed binary rollback claimed |

## Evidence artifacts

- [Bundle metadata and complete dependency list](builder-task0/bundle.json).
- [Three-width browser measurements](builder-task0/browser-parity.json).
- [Frozen/current-tree history replay summary](builder-task0/history-replay.json).
- [26 real membership/lifecycle assertions](builder-task0/real-membership.json).
- [Concurrent cutover lock mechanism](builder-task0/backfill-lock.json).
- [Real Next client-loaded public revisions](builder-task0/next-snapshot.json).
- [Reproduction instructions](../../../apps/web/tools/builder-preview-spike/README.md).

Raw outputs, initial red runs, full source-hash replay receipt, screenshots and
review notes remain in the ignored per-plan workspace
`.superpowers/sdd/2026-10-20-baci-chatgpt-store-builder/`. No real credentials,
production data or local TLS private keys are included in the reviewable files.

## Preview and runtime contract

`PortableHomeView` is the shared six-block presentation used by the inert widget
and the actual opt-in public `PublicPortableHome` adapter. Hero, Text and Footer
also share presentation shells with existing builder components. The widget has
no navigation, cart, checkout, analytics or catalog-fetch effects. Public links
retain normal navigation; preview links retain geometry without an `href`.
Header, Hero, Text, Button, Footer and ProductGrid are the complete v1 block list;
unknown props/blocks/templates/renderer versions refuse rather than falling back
under an exact-preview claim. The allowed property subset is defined by
`portableHomeSchema`, not the entire legacy editor configuration.

The public adapter obtains the existing published catalog API projection; the
preview receives a bounded merchant-matched snapshot. The browser comparison
uses identical deterministic catalog data/time and includes the real compiled
public CSS. This proves presentation parity for the tested projection; it does
not reserve prices or guarantee unchanged live inventory. No sample products
are silently substituted into an empty authorized catalog.

The published config is normalized, cloned and frozen. Its `home-v1:SHA256`
version is derived from that same config, and the public adapter renders the
frozen value associated with its marker. A mixed config/version DTO is rejected.
This is a config revision, not an authorization credential, publication receipt,
merchant identity revision or inventory reservation. Later publication services
still need their planned transactional authorization, revision and delivery proof.

The standalone MCP transport remains separate: fixed-origin HTTPS to the Next
execution gateway, no Next imports or upstream Supabase tokens. Cache Components
requires Next's default Node runtime; an explicit segment runtime export was
rejected in the initial spike. The fixture calls the real publication data-cache
function without mocking Next. External Vercel/Cloudflare eviction, OAuth and
live provider delivery remain later acceptance gates.

## Private storage and compatibility contract

All new storage/cutover SQL is **disposable fixture SQL**, including
`private-storage.sql`, `private-split.sql` and `private-lifecycle.sql`. No pending
production migration was added. The prototype must not be placed into the deploy
migration directory until the production adaptation/release work is accepted.

The complete replay used Supabase CLI 2.95.4, PostgreSQL server 17.6 and the pinned
PostgreSQL 18.3 client. The existing replay verifier's exact source registry,
hashes, bootstrap history and schema comparison were retained. A separate source
projection prevented local prototype files from weakening those checks.
Production was not queried. The old raw draft exposure was reproduced before
contraction; final acceptance exercised the installed private cutover repeatedly
with only synthetic tenant rows reset between runs.

The real-policy raw API suite covers owner and builder-edit staff access,
view-only read/no-write, anonymous/unrelated/non-builder/suspended denial and
revocation using an existing JWT. It uses the actual membership helpers and
history/job policies from the full replay. Synthetic account seeding suppressed
external welcome triggers; all tested lifecycle operations ran with normal
triggers, permissions and RLS. A separate non-inheriting fixture API login could
switch only to normal `anon`/`authenticated` roles.

The private table denies service-role table grants; normal-user business RPCs
are SECURITY INVOKER, and native apply's prior privileged execute grant is
revoked. The legacy name trigger remains public-only. Authorized enqueue captures
the private starter/revision server-side; supplied client starter data cannot
replace it. The extracted AI computation consumes that captured job snapshot
without reading private draft storage. The production legacy dispatcher is not
silently given a new private-table authority.

Local adapters preserve the existing load DTO, browser side-field publication,
onboarding and normal native apply semantics. A separate homepage-layout publish
contract preserves both pending private SEO/settings and current published side
fields. History failure rolls back the publication. Secondary drafts remain
private. The existing anonymous and authenticated shopper `published_config`
projection stays available.

### Cutover and rollback

Prepare compatible adapters, drain old draft writers and legacy queued jobs,
then reconcile/backfill under public/private table locks and contract public draft
columns in one transaction. Newer existing private rows are preserved. The real
lock test uses a synthetic schema inside the owned full-replay database: it proves
pre-lock commits are captured and a waiting late legacy writer fails after
contraction. It is a mechanism test, not a claim that a deployed cutover occurred.
The real lifecycle suite separately proves concurrent owner/staff CAS and history
rollback with actual policies.

Production rollout must activate the compatible adapters before admitting new
private-draft work. A rollback must retain those adapters or disable editing while
serving the unchanged public projection. Restoring private copies in public rows
is forbidden. An unadapted old editor binary is not a supported editing rollback;
its old query fails closed. No production reader or writer was switched here.

## Validation and review

Final focused suite: **18 files / 106 tests passed**, including portable/legacy
renderer regressions, schema/path/template tests, AI core extraction, two raw
Data API runs and browser/bundle checks. Full web typecheck (including tools and
MCP subchecks) passed. The Next fixture typecheck and cleanup regression passed.

A broad web-suite attempt encountered timeouts and repository audits while the
worktree was changing; it was stopped and is not reported as a clean full-suite
run. Frozen-replay registry tests passed after moving prototype SQL out of the
migration registry. The edge-inventory audit requires current bytes to match HEAD;
it passes on the frozen baseline and rejects an uncommitted source tree by design.
The current source remains uncommitted, so that HEAD-bound gate is not claimed
as passed for this patch.

The fresh reviewer found a same-store URL normalization bypass; regression tests
reproduced it and the reviewer confirmed the fix, explicit template eligibility
and renderer dispatch. CodeRabbit completed its review. Valid findings were
addressed: newer-private backfill preservation, portable replay logging and
removing prototype SQL from production migrations. The suggested blanket
`IF NOT EXISTS` change was skipped: these are fresh-schema fixture assertions;
masking a mismatched schema is not an acceptable replay proof.
