# Baci ChatGPT builder: staging and release runbook

## Decision

Latest owner scope is local preparation and local database only. PostgreSQL17.11 is available and selected explicitly for local journeys. No hosted project, remote credentials, DNS, or VPS process provisioning is authorized by this local continuation.

**NO-GO for production and submission.** This branch implements source and local fixtures. Local normal-role PostgreSQL journeys and the signed-token HTTP journey do not prove the real upstream Auth-provider, a complete staged web artifact, privacy cutover or an actual ChatGPT developer connection. Read [the exact staging scope](baci-chatgpt-builder-staging-scope.md) before any provisioning. Both existing submissions and all production stores remain protected.

## Isolation and prerequisites

1. Record the exact candidate SHA, clean-tree status, artifact hashes and dependency lock hashes. Any runtime change invalidates prior SHA-specific host/review evidence.
2. Owner selects the new Supabase project's organization and accepts any quoted cost. Never target production `aivqthbxdshhltbwipbr` or Scribe `fjeivihgcwpvbvsqtapq`; assert the returned new project ref in every migration/provisioning command. Do not copy user data, auth identities, orders, catalog rows or provider credentials from production.
3. Check VPS disk, memory, running builds, ports and service ownership. Measure required web build/release/rollback disk from artifacts plus build high-water mark; 6.2GB free is currently unqualified. Do not delete shared caches, restart Docker, stop runners or remove rollback images as a side effect. Expand capacity or obtain a bounded cleanup instruction first.
4. Confirm ownership/availability for every new staging DNS host and TLS certificate. Avoid aliases to production, wildcard takeover and reserved merchant slugs. Bind all new services to loopback and place only their scoped virtual hosts behind TLS.
5. Complete canonical staging-profile plumbing: issuer, protected resource, JWKS, gateway, linked edit-runner URL, owner approval URLs, canonical public store root and public-verifier origin must all agree. Several current production-design constants deliberately block this qualification; never sed-replace bundles, fake production DNS or reuse the submitted connector.

## Credential and process contracts

- Auth broker: private `baci_builder_auth_storage` only; no authenticated membership, role creation or bypassRLS. Use independently generated ES256 signing, cookie and vault key material. Validate issuer/resource/inner callback and stable upstream subject. Keep credentials in restricted files, never evidence/stdout/arguments containing values.
- MCP adapter: public JWKS and fixed staged backend only; no database, vault or owner cookie. Separate listener18892, timeout/body limits and graceful shutdown.
- Edit runner: renew each linked user's dedicated grant; normal RLS client, bounded operations/leases, AI quota/rate limit, no service-role mutation or automatic application/publication.
- Owner web gateway/approval: separately built staged Next web app on18890. Explicit runtime bootstrap must install gateway, owner authorization/CSRF and publication dependencies. Auth broker listener18891. Current library modules are not a complete service bootstrap; no deployment is allowed until those entrypoints and shutdown/restart tests pass.
- Publication verifier: separate INSERT-only evidence role with no business/session grants. Bound public HTTPS egress and headless rendering; never pass owner cookies or bearer tokens. Cache eviction receives only a committed owner-authorized receipt. No global admin outbox drain.
- Keys/credential identities are unique to staging; exact Platform callback comes from a new isolated developer connection, never from either existing submission. Configure inner client independently and record only metadata/fingerprints.

## Schema expansion and privacy cutover

1. On the disposable project, capture empty-data baseline, schema migration ledger and tool/package versions. Use pinned PostgreSQL17 and current Auth/PostgREST qualification, not the reduced PostgreSQL18 local fixture as a substitute.
2. Replay the full supported schema and exact builder source registry. Verify every registered migration hash, normal-role grants, ownership/staff semantics, current production-style readers and raw Data API access. Do not import production business data.
3. Deploy compatible staged web/worker/public consumers with private-storage/linking flags **off**. Backfill private drafts; prove row counts, concurrent legacy/new writers and revision triggers agree. Incompatible mobile/native/public consumers are a stop condition.
4. Invoke the explicit operator privacy-contraction procedure only in the disposable target after those checks. No ordinary migration or feature toggle alone authorizes contraction. Test anon/customer/staff/wrong-owner direct REST projection and RPC attacks after cutover.
5. Rollback must retain private storage and restrictive privileges. Do not restore draft columns to public reads or re-enable old unsafe artifacts. Keep a compatible rollback image; otherwise remain in maintenance mode rather than broadening access.

## Qualification matrix

- New owner: cold PKCE linking/explicit create consent → private store → later same-token edit binding → queued AI edit → status-only polling → explicit apply → exact inert preview → owner approval → committed receipt → verified public revision.
- Existing live merchant: record public config and actual version first; draft creation/edit/preview/approval request must leave them unchanged until confirmation. Secondary pages and pending/published SEO/settings stay unchanged.
- Negative cases: wrong tenant; removed/revoked access; expired bearer/session; stale revision; same-key duplicate/changed payload; malformed/unsafe model output; blocked launch facts; delivery/cache/response loss. Include lease recovery, reconnect/restart persistence, superseding native publish/unpublish and fresh owner-session retry without republishing.
- Real ChatGPT developer host: capture eight accepted tool names and schemas, OAuth prompts, no credentials/model confirmation, fullscreen/height, theme, safe links/blocked links, actual preview rendering, owner approval and public headless proof. Record latency/quota and limitations. Local SDK or static browser fixtures are not this evidence.
- Run `pnpm --filter @baci/web verify:builder-provider` separately: the isolated auth package is outside the workspace and its17native Node suites are not included in root Vitest. A green root run is not provider qualification; record Docker/PostgreSQL/Auth failures separately.
- Full root `pnpm lint`, `pnpm typecheck`, `pnpm test` at candidate source; record pre-existing failures separately. Obtain independent Codex review (owner's replacement for CodeRabbit), exact-head required GitHub checks/review before any later merge/release. No review request/push is implied by this runbook.

## Artifacts, package and promotion

`pnpm --filter @baci/web build:builder-mcp` builds the editor-free preview and standalone adapter. Keep generated hashes and build logs; an adapter-only artifact is insufficient for the web/auth/runner/verifier lifecycle. Rebuild twice and compare content hashes before calling artifacts reproducible. Supply a complete staged web/auth bootstrap artifact before deployment.

The separate package source is `apps/web/chatgpt-builder-plugin/`. It deliberately omits an unverified `mcp.json` connection and is not upload-ready. After endpoint/discovery/host verification, create that file with the verified new endpoint, inspect the deterministic one-root ZIP and all referenced assets, and bind its hash to the candidate. Review public legal URLs and developer identity, make a synthetic reviewer account, write instructions and record a demo. Never store reviewer passwords in the archive/evidence. Do not upload or create/change a submission here.

Production remains a separate owner-authorized VPS release ending in the approved prebuilt deployment flow. This runbook does not authorize `vercel build`, cloud builds, emergency hosted jobs, production migrations, app registration, submission, approval or publication. Stage promotion only after the entire checklist has exact-SHA evidence; reconcile uncertain effects before retries. Stop if health, grants, TLS, discovery or public proof fails. No automatic unpublish or reverse migration follows a delivery failure.

## Current evidence and documentation

- [Task9 local release evidence](../superpowers/specs/2026-10-22-baci-builder-local-release-evidence.md): scope, artifact hashes, passing checks and unqualified gates.

- Task8 evidence: [publication implementation](../superpowers/specs/2026-10-22-baci-builder-publication-evidence.md).
- Local Task9 journeys use PostgreSQL17.11 RLS/services and deterministic generated plans. The authenticated create/edit journey also passed through native PostgREST16.4 with signed tokens. Its upstream `/auth/v1/user` response is simulated; this is not real Supabase Auth, pinned-container conformance, or ChatGPT host proof. Test state is synthetic and owned processes are cleaned per test.
- OpenAI package formats/listing links: [package guide](https://developers.openai.com/plugins/build/plugins), [submission guide](https://developers.openai.com/plugins/deploy/submission), [submission errors](https://developers.openai.com/plugins/deploy/submission-errors). Retrieved2026-10-22; no submission portal action performed.
- Supabase changelog retrieved2026-10-22: current TLS deprecation requires modern TLS; no staging TLS qualification is inferred from retrieval.
