# Product 1941 eSIM capture — 2026-10-30

The release operator submitted product **1941** once under the owner's approved
live-test budget at **US$0.04**, then observed terminal `success` through the
authenticated order read. The sanitized replay is checked in at
`apps/web/src/lib/imei-providers/petrock/fixtures/petrock-esim-1941-20261030.json`.
It retains only model and compatibility fields. Device identifiers, order and
reference identifiers, tokens and raw transport data are omitted.

Observed fields:

- `Model: APPLE_A3525_IPHONE 17 PRO MAX_IPHONE 17 PRO MAX (CANADA-JP)`
- `eSIM Compatible: Yes`
- `Physical SIM Compatible: No`

The parser maps the captured eSIM label and extracts model number `A3525` from
the explicit `APPLE_A####_` token only when the provider did not supply a separate
model-number field. It preserves the original device string and does not infer
blacklist safety or fabricate absent fields.

This verifies the existing `esimCompatibility` promised fields (`device`,
`modelNumber`, `esimCompatibility`) for the observed iPhone IMEI scope.
The provider binding and shared tier are restricted to Apple smartphones with
IMEI input. The binding requires an explicit smartphone category, Petrock global
enablement, tier allowlisting and async client support. Customer price remains
**₦700**, with the unchanged **US$0.04** supplier baseline. No tablet, serial,
other-brand or other-device completion is claimed.

At the eSIM capture stage, **21** info-tier candidates remained unverified and
dark (14 catalog matches and seven unmatched candidates). The subsequent
[part-number capture](petrock-part-number-capture-20261030.md) promotes its scoped
core diagnostic, leaving 20 dark candidates. The initial pre-probe snapshot is in
[the earlier scoped-activation report](petrock-scoped-activation-evidence-20261030.md).
Its zero-addition result predates this captured probe.

`esimCompatibility` is included in `PUBLIC_IMEI_SERVICE_TIERS` and remains limited
to Apple smartphones using IMEI input. Both storefront selectors additionally
require the server's runtime availability response. Pending, failed, disabled or
incomplete capability discovery hides this Petrock-only tier; explicit server
availability admits it. Database price activation requires
`20261030120001_imei_verified_diagnostic_prices.sql` after
`20261030120000_imei_authenticated_access_boundary.sql`, before eSIM allowlisting
or application publication. Shared retail and supplier-baseline prices are unchanged.

The exact captured parser regression failed before the fix and passed afterward.
Seven targeted web suites passed **121 tests**; the shared tier suite passed
**21 tests**. Tests cover fixture sanitization, explicit model-number precedence,
invalid token shapes, all promised parsed fields, disabled/missing flags, unsupported
hardware categories and the remaining dark candidate routing. These local results
do not establish deployed customer checkout completion or broader device coverage.
