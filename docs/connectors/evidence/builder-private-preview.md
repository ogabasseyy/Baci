# Task 7: private homepage preview

Date: 22 October 2026. Parent commit: `d6ba0f9edd`.
Source-only implementation; both existing submissions are unchanged.

## Implemented boundary

The seventh builder tool, `preview_storefront`, requires the exact current opaque
homepage draft version. It runs on the private authenticated gateway. It shares
the canonical connection/ownership/scope read RPC with status before and after
projecting normal-user, merchant-scoped queries. Stale versions and revoked access
never return a render snapshot. Unsupported templates/blocks/pages are rejected
with a safe Baci editor fallback. Layout drafts, public content, carts, products,
orders and payments are not mutated.

The response includes real display identity (with currency from `payout_currency`),
a maximum 24-product active catalog display projection, captured timestamp and
canonical launch-readiness missing items. Contact/bank details and private product
fields are not returned. Catalog/readiness are read snapshots, not reservations or
publication authorization. Task 8 must recheck readiness at publication.

`PreviewRendererCore` wraps Task 0's shared six-block `PortableHomeView` with strict
schema/merchant/asset validation and `inert` permanently enabled. Neither the full
editor nor Next runtime is bundled. The new explicit pnpm workspace package has
independent Turbo build/typecheck/test/lint tasks. The offline lockfile update adds
only its importer, with existing installed SDK/dependency versions.

Only preview advertises `_meta.ui.resourceUri`. The versioned static resource is
`ui://baci-builder/home-preview-v1.html`, MIME `text/html;profile=mcp-app`, and contains
no tenant snapshot. CSP denies API connections and frames, and restricts image
origins. Asset validation rejects credentials, query/signed URLs, private storage
paths and unapproved origins. No host globals or local/session storage hold data.
The standard MCP Apps bridge negotiates inline/fullscreen, inherits host theme,
opens only the fixed authenticated editor URL, and clears old results on new
input, error, cancellation and teardown. Sizing covers alerts, late connection,
images and missing ResizeObserver. Shopping links/controls are inert.

## Evidence and limitations

Tests were observed failing for absent service/widget/resource before implementation.
Additional regressions caught late-host sizing and a partial context update resetting
the dark theme; both passed after correction.

- Focused transport, gateway, contract and widget source tests passed initially:
  12 files / 32 tests.
- Signed JOSE / PostgREST / normal-user RLS journey plus preview/widget tests:
  4 files / 11 tests. The disposable fixture adds scoped display tables and mock
  aggregate readiness RPCs; this is not a production policy replay. It proves real
  service queries exclude draft products/private fields, preserve revision and
  unpublished state, and reject after canonical revocation.
- Real browser runs the built standard SDK in an owned iframe host at 375, 768
  and 1200 pixels. All six blocks render; zero live hrefs, tools/call, checkout,
  navigation or page errors. A declined Expand shows an alert, and a revoked
  result clears the old merchant. Screenshots and geometry are local `/tmp` evidence.
- The self-contained bundle measured approximately 1.01 MB raw / 235 KB gzip,
  below 3 MiB / 1 MiB. Build tests enforce those ceilings and reject editor/Next/DB
  imports and tenant fixtures.

Final current-source review and broader check outcomes are recorded below. Production DNS/TLS/bootstrap, actual ChatGPT host QA, activation and
publication remain later release gates. Neither submission was opened or changed.

Reference: [OpenAI standard MCP Apps UI and CSP](https://developers.openai.com/plugins/build/chatgpt-ui).

## Final verification

- Independent Codex review found a P2: CSS theme backgrounds could smuggle a
  signed image URL around the image-field validator. Service and widget tests
  failed on the exact payload, then passed after validating the whole theme tree.
  Unknown resource functions, escapes, comments and schemes are rejected; safe
  color/length functions remain supported. Codex current-source rereview: clean.
- A separate RED→GREEN regression prevents initialization from reattaching host
  actions after teardown. Final edge suite: 4 files / 15 tests pass.
- Focused final retry: 42 files / 237 tests pass, including built-widget browser
  and Task 0 public/widget six-block parity at all three widths. One additional
  authenticated database test was blocked before setup by Docker containerd blob
  storage I/O errors. Its earlier Task 7 real signed/PostgREST preview journey
  passed, as recorded above; latest full revalidation is incomplete.
- Final browser asset/UTF-8 check passes at all three widths with loaded fixture
  logo/product images, inert links, visible errors and revocation clearing.
  The parent host harness now declares UTF-8 to avoid corrupting fixture text.
- All 7 monorepo typecheck tasks pass; all 5 lint tasks pass with existing image
  warnings. The new workspace package is included in both.
- Final standalone build passes: HTML 1,010,799 bytes raw / 234,900 gzip,
  server bundle 126 KB, with the static resource copied beside the server.
- Full monorepo tests were attempted with one worker and stopped as local storage
  approached exhaustion. They are incomplete, not a passing full suite. Only the
  owned Next fixture's rebuildable `.next` output was removed after checking no
  process used it; peer projects and evidence were preserved.
- Docker could not remove the dead owned fixture `baci-builder-auth-85f1aab2`
  because its metadata database reports an I/O error. No daemon restart, image
  prune or peer container operation was attempted. This local infrastructure
  issue must be resolved before another database/release test.

No deployment, runtime activation, production migration, credentials, proxy or
protected configuration changes occurred. Both submissions remain unchanged.
