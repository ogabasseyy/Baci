# Local builder OAuth feasibility

These fixtures create no plugin, change no submitted integration and call no
production Baci/Supabase service. They are not application routes or production
OAuth configuration. All identities, signing keys and client credentials are
synthetic and removed with the fixture. Do not deploy these automatic login and
consent handlers.

From the repository root, using Node 24 and pnpm 11.7.0:

```sh
pnpm --dir apps/web/tools/builder-oauth-spike/candidate --ignore-workspace install --frozen-lockfile
BACI_BUILDER_OAUTH_PROBE=1 PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm --filter @baci/web exec vitest run tools/builder-oauth-spike
pnpm --filter @baci/web exec tsc --noEmit -p tools/builder-oauth-spike/tsconfig.json
```

Docker must be running. The upstream fixture uses PostgreSQL and Supabase Auth
images pinned by digest in `upstream-fixture.mjs`; it creates uniquely named
containers/network, binds the API to loopback, and removes only its own resources.
It registers a synthetic confidential client through the isolated Auth admin API;
all tested consent, tokens, refreshes and disconnects then use ordinary user flows.
This setup credential grants no production or user-facing admin permission.

The provider persistence adapter is disposable SQLite, including atomic consume.
The replica test starts a second independent Node process against the same local
database. It is not the production multi-host persistence adapter. TLS verification
is disabled only for fixture-owned loopback HTTPS servers and never globally.
The gateway proof uses the repository's installed MCP server/node SDK v2 and the
candidate's pinned JWT library; the existing buyer dependency graph is unchanged.

`BACI_OAUTH_CANDIDATE_DIR` can select another installation of the exact pinned
candidate dependencies. `BACI_BUILDER_OAUTH_EVIDENCE_DIR`, when set to an existing
absolute directory, receives only the four sanitized result summaries. Ordinary
runs do not modify tracked evidence. The integration tests are opt-in; skipped
integration tests are not a passing feasibility proof.

See [the acceptance report](../../../../docs/connectors/evidence/builder-oauth-acceptance.md)
and [provider decision](../../../../docs/adr/builder-chatgpt-oauth.md).
