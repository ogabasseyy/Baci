# Task 0 feasibility probes

These are opt-in, disposable probes. They do not deploy or edit submissions.
Run from the repository root with Node 24 and the frozen workspace dependencies.

```sh
BACI_BUILDER_FEASIBILITY=1 PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm --filter @baci/web exec vitest run tools/builder-preview-spike/bundle-feasibility.test.tsx
BACI_BUILDER_DATABASE_PROBE=1 PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm --filter @baci/web exec vitest run tools/builder-preview-spike/privacy-compatibility.test.ts
```

The bundle acceptance test verifies the explicit six-block portable renderer and
rejects editor/Next dependencies. Browser parity compares the actual public
presentation and standalone bundle at 375/768/1200 CSS pixels.

The database characterization creates uniquely named Docker containers and a
network, uses synthetic identity helpers and data, copies the table/SELECT
policies from repository migrations, calls a loopback-only PostgREST API, and
removes only its own containers/network in `finally`. Cached images required:
`postgres:17-alpine` and `public.ecr.aws/supabase/postgrest:v16.2`.
It is **not** a full migration replay or production security assessment.
The SQL prototype is in `private-split.sql`. The proposed split is test SQL only, not a migration ready for application.
There is no real credential: its signing secret is disposable fixture data.

## Real Next runtime probe

Generate a local-only self-signed TLS key/certificate in the ignored per-plan
workspace. Start `next dev tools/builder-preview-spike/test-fixtures --webpack
--hostname 127.0.0.1 --port 31987 --experimental-https
--experimental-https-key <absolute fixture key path>
--experimental-https-cert <absolute fixture certificate path>` through
`pnpm --filter @baci/web exec`. Then run:

```sh
node apps/web/tools/builder-preview-spike/runtime-probe.test-support.mjs
```

Stop only that fixture server afterward. TLS verification is disabled only in
this probe's hard-coded loopback request. The test route has no authentication
and must never be deployed. It imports the real publication cache function;
it does not invoke the external CDN purge orchestrator. A passing probe proves
Node/Next cache compatibility, not OAuth, production TLS or delivery.

See the [acceptance report](../../../../docs/connectors/evidence/builder-runtime-preview-acceptance.md)
for the bounded passing decision, full replay evidence, lifecycle results and
remaining production gates. Prototype SQL remains outside the migration registry.

Forced timeout cleanup regression (owns only its uniquely named resources):

```sh
node --test apps/web/tools/builder-preview-spike/privacy-timeout.probe.test-support.mjs
```
