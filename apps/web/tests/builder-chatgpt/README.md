# Builder release verification

Run from the repository root:

```sh
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm --filter @baci/web verify:builder-release
```

The normal fixture uses the pinned disposable PostgreSQL17 Docker image. If Docker is unavailable on this host, an explicitly labeled local-only fallback can run the database/business-service cases:

```sh
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false BACI_BUILDER_LOCAL_PG=1 pnpm --filter @baci/web verify:builder-release
```

The default fallback uses an isolated PostgreSQL18 Unix socket. The owner-selected local PostgreSQL17.11 is exercised explicitly with `BACI_BUILDER_LOCAL_PG_MAJOR=17 BACI_BUILDER_LOCAL_PG_BIN=/opt/homebrew/opt/postgresql@17/bin` added to the command. Each fixture cleans its own server/data directory. The selected binary/version is checked, but this is **not** pinned Supabase container, real upstream Auth or ChatGPT conformance evidence. Native PostgREST16.4 is also exercised by the authenticated create/edit and Data API authority suites.

`lifecycle.test.ts` starts after the fixture's normal-role private-store creation and seeded connection consent. It covers edit/lease/poll/apply/preview/approval/commit and confirms public state is unchanged before commit, for a new private store and an existing published one. It stops at `verifying`. The separate HTTP same-token create/edit suite passes using signed tokens and real local PostgREST with a simulated upstream Auth response. Cold linking, real upstream Auth, successful actual public delivery and host interaction remain separate required release gates; these tests alone cannot set `localLifecycle=true`.

`negative-journeys.test.ts` covers tenant, revoked/expired canonical grants, stale draft, duplicate/conflicting requests, unsafe generation/lease recovery, launch blockers and failed/superseded delivery. Existing Task3 provider, Task6 HTTP, Task7 actual browser and Task8 recovery suites remain consumers; do not replace their missing external qualification with a seeded synthetic connection.

The release checklist consumes separately reviewed exact-SHA evidence. It is a report, not a cryptographic attestation or deployment permission. No automated trigger, provider provisioning, app registration, submission action or production write is included.

## Native local provider checks

With the three local PostgreSQL flags above, run the native broker tests using `pnpm --dir apps/web/tools/builder-auth exec node --test` and the explicit `*.node.test.ts` file list, excluding only `upstream-integration.node.test.ts`. That integration requires the pinned GoTrue Docker fixture; do not replace it with a mocked pass. The dedicated full `verify:builder-provider` command still includes that required integration and remains unqualified without Docker. No shared Docker state is changed by the native checks.
