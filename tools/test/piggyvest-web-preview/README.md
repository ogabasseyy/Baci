# Synthetic localhost savings preview

From `/Users/mac/Baci-worktrees/cursor-savings-phase1`:

```sh
node tools/test/piggyvest-web-preview/server.mjs
```

Open http://127.0.0.1:4179/. The server binds only loopback with a strict port.
Vite config/env file discovery and public assets are disabled. No Next dev server
or production env file is loaded. Browser CSP restricts connections to this local
origin and its Vite websocket. No dependency installation is required.

The actual `SavingsScreen` renders the composed journey, including its real
PolicyPanel, FundingPanel and CustomerSavingsStatus. `screen-source.ts` supplies
a serializable synthetic source using the component's current types. The savings
submission callback simulates consent in browser memory after a local delay;
there is no fetch, POST, database, provider, storage or money mutation. This is
not the actual storefront. The ready funding example contains
`NOT-A-BANK-ACCOUNT` and a fictional bank label, never usable bank details.

Controls select two exact variant/condition combinations, funding pending/error/
placeholder-ready states, progress states, synthetic session absence and simulated
consent failure. Variant, session and failure-mode changes remount the scenario,
resetting consent AND synthetic eligibility. Funding/progress changes preserve
consent and eligibility. This fixture does not replace the panel's dedicated
stale-promise regression tests. Consent success is only a local accepted projection.
Terms and their placeholder hash are synthetic, not a real agreement/hash proof.

To demonstrate the gate, select ready funding, accept the supplied draft terms,
and observe that no account or progress appears. Consent does not change the
default blocked eligibility. Only then choose Allowed under the separate
Synthetic trusted eligibility control. That control invents an explicit matching
test projection; it is not a real eligibility decision. Pending/unavailable
eligibility also hides funding/progress. Logout and variant changes remove stale
details immediately and require fresh simulated consent and fixture eligibility.

```sh
node --experimental-strip-types --test tools/test/piggyvest-web-preview/fixtures.test.ts tools/test/piggyvest-web-preview/screen-source.test.ts
```

All four fixture/source tests pass. Node may warn about module auto-detection because this
isolated fixture deliberately does not edit the workspace package configuration.
Generated Vite cache is isolated in the ignored `.vite` folder here.

Files: server.mjs, config.mjs, index.html, app.tsx, fixtures.ts, screen-source.ts,
screen-source.test.ts,
fixtures.test.ts, app.test.tsx, server.test.mjs, config.test.mjs,
vitest.config.mjs, styles.css, .gitignore and this report. Production source files,
package/lock/env files and other agents' work are not edited. Full browser/mobile
acceptance and root checks belong to the parent. Leave the running server alive
for parent Browser QA; Ctrl-C in its terminal stops it when QA is complete.

## Added app/server coverage

```sh
pnpm --dir apps/web exec vitest run --config ../../tools/test/piggyvest-web-preview/vitest.config.mjs
node --test tools/test/piggyvest-web-preview/config.test.mjs tools/test/piggyvest-web-preview/server.test.mjs
```

Results: six actual-SavingsScreen RTL app tests, four Node fixture/source tests,
and three Node config/server tests passed. App tests prohibit fetch and cover
separate consent/eligibility gating, variant reset, funding/progress pending and
error states, simulated consent failure and logout. Config tests assert unchanged
loopback/env/public-file restrictions. Server tests
verify side-effect-free import and perform GET-only checks against the existing
127.0.0.1:4179 preview, including denial of an existing out-of-allowlist README.
The HTTP test requires the preview to be running; it never starts or stops it.
No root configuration, dependency, env file or production source was changed.
This is focused fixture coverage, not production integration or a security audit.

## Isolated cancellation fixture

The separate **Synthetic cancellation fixture** section renders the actual web
`CancellationReview`. Controls are **Cancellation quote** (Available/Unavailable),
**Cancellation result** (Prepared/Uncertain), **Cancellation goal** (A/B), and
**Cancellation session** (A/B/No session). They do not modify savings controls.
Amounts are invented: principal 10000 kobo, paid interest 700 kobo, pending
interest 300 kobo. Goal-specific operation IDs stay stable across renders.

Choose a result before checking the actual review's consent box and clicking
**Prepare cancellation**. The in-memory callback validates the strict shared
confirmation contract and every exact quote assertion, then returns a simulated
receipt. No actual reservation, refund, collection pause, storage, database or
provider dispatch occurs; even prepared/uncertain messages are display fixtures,
not server acknowledgements. Reload to reset an attempted operation. Switching
quote availability, goal or session clears consent; no-session hides the quote.
Savings-control changes preserve the independent cancellation scenario.

The preview Vitest command above also runs colocated cancellation fixture and
RTL tests, including malformed/stale confirmations, uncertain outcomes, disabled
resubmission and context switches. Cancellation RTL tests prohibit fetch and
browser storage access. The integration test first failed against the old app
because the cancellation section was absent. The existing server at 4179 was
left running without a restart or config/security-boundary changes.
