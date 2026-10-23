# Builder MCP transport and gateway — Task 6

Date: 2026-10-22. Base: `3eabf86ba8`.

## Implementation and authority

This is local inactive source only. The separate Node/Streamable HTTP adapter
advertises the six implemented list/status/create/queue/poll/apply tools. It has no
preview resource, publication handler, upstream OAuth client, vault or database
client. The fixed Baci HTTPS execution gateway owns dedicated builder-token
verification, live consent/ownership and normal linked-user RLS services. Unknown
credentials never fall back to cookies. Caller-selected store IDs are selectors;
MCP sessions convey no authority.

The resource metadata and per-tool OAuth schemes match the dedicated builder
issuer/audience. Authentication is signaled both by transport WWW-Authenticate
headers and MCP tool `_meta['mcp/www_authenticate']`, with safe descriptions.
Schema-only discovery works without linking; all business handlers require it.
The gateway independently rechecks every data/action request, and SQL retains
canonical mutation/replay fencing after any long-running work.

The Node listener enforces allowed Host/Origin, body size, stateless isolation,
timeouts and shutdown cleanup. The backend client fixes origin and route, forbids
redirects, bounds response bytes, validates UTF-8/JSON and never retries an
uncertain mutation automatically. Stable actor/connection throttles do not reset
when bearer tokens rotate. Telemetry uses Muse's pure allowlist builder, without
reusing its credential store, transport or best-effort audit writer as effect
proof. Mutations retain their transactional evidence.

## Findings corrected during implementation

- A direct canonical schema import pulled the storefront template registry into
  the standalone graph. The protected business-types file was not changed.
  Generated, parity-checked JSON wire contracts now isolate the process; gateway
  validation retains canonical web transformations and refinements. Pure failure,
  name/scope and size contracts were extracted without changing their meaning.
- The SDK client strips unknown top-level tool extensions; raw HTTP tests verify
  OpenAI `securitySchemes` discovery while typed client tests verify `_meta`.
- A real HTTP SDK client caught output-union framing that in-memory tests missed:
  the legacy codec expected a `result` wrapper. All existing output branches are
  objects; the Standard Schema adapter now advertises that object root explicitly.
  The exact failing real-client regression passes with flat structured results.
- Unknown or malformed backend fields and error messages cannot enter model
  output. Only validated DTOs and reconstructed fixed error text are returned.

## Verification boundaries

Unit/protocol tests exercise initialize/discovery, all six strict schemas,
annotations/OAuth metadata, missing/expired/insufficient credentials, malformed
and oversized requests, invalid output, foreign Origin, session-header injection,
request isolation, shutdown, redirects/oversized responses, actor/connection
throttling and redaction. Contract tests preserve Muse's four read tools and the
buyer's v5/current plus v4 compatibility resource registrations.

The existing signed-token/PostgREST journey now calls all six real gateway service
handlers under normal RLS. It tests store-list/status, established-store creation
rejection, another merchant's selector, queue/poll, explicit ready-candidate apply,
replay and canonical revocation. No public page is published by the journey.

A separate owned-loopback probe runs a real Next dev Node route behind a locally
trusted TLS certificate and calls it from the actual MCP SDK over Node HTTP. It
verifies fixed HTTPS forwarding, structured output and revocation challenges.
Its canonical connection is a synthetic JSON fixture, not a production DB. The
business RLS journey is a separate proof; these tests do not claim deployed Next
proxy/session wiring or live ChatGPT behavior. The probe removes only its own
server/process group and temporary files.

The isolated TypeScript check and standalone bundle pass. The bundle-graph test
rejects Next/editor/component/database/provider/vault imports. Generated wire
contracts are checked against the canonical schemas in normal CI tests. Full
monorepo validation was also requested because this task adds package build/check
scripts; final results and any pre-existing failures are reported separately.

## Inactive release boundary

The fixed production route returns 503 while the account-linking/private-storage
flags are false or no private runtime is installed. No runtime/environment/role,
DNS, production migration or deployment was provisioned. Task 9 must mount the
private gateway/session facade, prove canonical TLS and actual staging behavior,
then authorize its own separate rollout. Both Ogabassey and Muse submissions,
including their existing tool discovery and review status, were not touched.

Reference checked: [OpenAI Apps SDK authentication](https://developers.openai.com/apps-sdk/build/auth/).
Installed SDK source/types were inspected for tool metadata, Standard Schema,
legacy projection and Node transport behavior; no dependency upgrade was made.

## Final local verification

- Focused final retry: 36 files / 171 tests pass, using one worker.
- All six monorepo typecheck tasks and all four lint tasks pass (existing image warnings).
- Standalone typecheck, 63 KB bundle, wire parity/isolation and real HTTPS Next probe pass.
- Independent Codex staged-source review against 3eabf86ba8: clean; no verified actionable defects.
- Full monorepo tests were attempted: mobile-admin completed 929 files / 4,723 tests, but one suite failed loading with ENOSPC. Turbo stopped before the remaining package tests. This is an incomplete full test gate, not a passing monorepo suite. The focused retry passed after that failure.

Production bootstrap, proxy attribution, canonical TLS and actual ChatGPT linking remain release gates. Socket-peer IP throttling must be checked against the deployed proxy topology. Aborting transport cannot establish remote mutation rollback; status and idempotency reconciliation remain necessary. Neither submission was changed.
