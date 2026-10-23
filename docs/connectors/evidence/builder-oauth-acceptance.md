# Builder OAuth Task 1 acceptance

Date: 21 October 2026. **Local provider/SDK feasibility: GO after Codex review.**
Both existing submissions, production deployments, credentials and settings are
unchanged. No real merchant/user data was queried. The test broker login and
consent are synthetic; this is not a real ChatGPT account-link acceptance run.

## Reproducible checks

Run the [fixture commands](../../../apps/web/tools/builder-oauth-spike/README.md).
The opt-in suite has four integration groups covering 36 named checks, plus child
lifecycle regressions. The reports contain check names and versions, never tokens,
client secrets, signing keys or personal data.

| Boundary | Evidence | Result |
| --- | --- | --- |
| HTTPS discovery, mandatory S256, exact callbacks, issuer responses and resource binding | [Provider](builder-oauth/provider.json) | Passed |
| Claim shape, code consumption by two independent provider processes, refresh rotation and reuse-family invalidation | [Provider](builder-oauth/provider.json) | Passed |
| Persistence and revocation after restart; predefined client survives restart | [Provider](builder-oauth/provider.json) | Passed |
| Explicit offline scope/consent, verified-email UserInfo, ID-token-hint reauthorization | [Provider](builder-oauth/provider.json) | Passed |
| Plural authentication methods, compatible singular choice, exact metadata/callback | [CIMD](builder-oauth/cimd.json) | Passed with selection adapter |
| Private/unknown metadata URL rejection before fetch; no redirect following | [CIMD](builder-oauth/cimd.json) | Passed for synthetic metadata fixture |
| SDK v2 in separate child, same accepted audience at fixed gateway, wrong issuer/audience/expiry refusal | [Gateway](builder-oauth/gateway.json) | Passed |
| Caller cannot select upstream destination; gateway redirects refused; child inherits no credential environment | [Gateway](builder-oauth/gateway.json) | Passed |
| Actual Supabase code/S256 exchange using maintained upstream client; inner state/nonce/verifier substitution rejected | [Upstream](builder-oauth/upstream.json) | Passed |
| Two independent links, verified UserInfo, concurrent browser/link refreshes | [Upstream](builder-oauth/upstream.json) | Passed |
| One-link logout preserves browser/other link; reauthorization keeps subject; whole-client revocation invalidates both links | [Upstream](builder-oauth/upstream.json) | Passed |

## Versions and provenance

- Node 24.11.1; pnpm 11.7.0.
- `oidc-provider` 9.12.2; `openid-client` 6.8.8; `jose` 6.2.12.
- Repository MCP server 2.3.1 and Node transport 2.1.1; existing buyer source and
  dependencies unchanged.
- Supabase Auth 2.197.0, image digest
  `sha256:1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b`.
- PostgreSQL fixture image pinned by digest in the source. This is an Auth protocol
  fixture, separate from Task 0's full Baci migration replay.
- Candidate production-dependency audit reported zero known advisories at execution;
  this is not a guarantee of vulnerability absence. Upstream release information,
  configuration documentation and Supabase's changelog were checked.

## Failures observed and resolved

The first conformance run failed because the fixture did not exist. Configuring
only an ES256 signing key also required matching client ID-token preferences.
A restart exposed the fixture client's stale keepalive connection; local requests
now use fresh connections. A concurrent code test exposed shared outer grants:
new authorizations now load only their explicit consent result, rather than
silently sharing an earlier session grant. Raw OpenAI metadata prefers a method
not enabled by the public-client fixture; a red/green regression demonstrates the
explicit mutual-method selection. These are local configuration/interoperability
findings, not claims that existing submissions are broken.

The real Supabase fixture required an asymmetric signing key marked for signing,
explicit issuer and the normal authorization-details step before consent. The
maintained client then qualified `client_secret_post`. Inner wrong state/nonce/S256,
revoked refreshes and invalid gateway tokens are intentional negative cases.

## Remaining gates

See the [ADR](../../adr/builder-chatgpt-oauth.md). Production shared persistence,
encrypted upstream vault, refresh locking, live connection/owner authorization,
real consent UI and staging linkage remain implementation gates in Tasks 3–9.
The gateway test is a local transport/audience fixture, not the production Baci
execution gateway or proof of end-user business writes. Task 0 separately proves
the real Next runtime/cache boundary. Synthetic CIMD fetching does not certify a
production DNS-rebinding-safe fetch implementation. No production client, issuer,
callback, environment setting or submission was created or changed.

## Final validation and review status

The opt-in suite passed **4 files / 9 tests**, including all four integration
groups and child-lifecycle, interrupted-cleanup and database-readiness regressions. Its four sanitized reports contain
36 named protocol/boundary checks. The fixture TypeScript check and targeted
Biome check passed. Three existing buyer widget escaping regressions passed;
ten unrelated cases were skipped. No full web/monorepo suite is claimed for this
isolated tool-only addition. Relative documentation links and JSON reports were
validated. The candidate dependency audit reported zero known vulnerabilities.

CodeRabbit was unavailable because of account capacity/seat limits. The owner
explicitly authorized Codex as its replacement. Independent Codex review found
two P2 issues: CIMD interruption cleanup and missing negative consent evidence.
The interrupted probe now removes its TLS key and SQLite directory on SIGTERM;
that regression failed without the handler and passed with it. The provider probe
requests offline access with the prompt omitted while the fixture user declines
consent, and verifies that no authorization code is issued. Codex independently
confirmed both fixes and issued a clean verdict.

The final suite also exposed initdb's temporary Unix-socket readiness race. A
bounded TCP check now excludes that temporary server, with a deterministic
red/green regression. Codex reviewed this final delta with no actionable findings.
No production/submission action was taken, and all owned Docker fixtures were
removed. The local Task 1 commit records this accepted provider decision.
