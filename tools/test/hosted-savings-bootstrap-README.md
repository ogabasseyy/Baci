# Fresh savings schema prerequisite

From the repository root:

```sh
pnpm --dir apps/web exec tsx ../../tools/test/hosted-savings-bootstrap-cli.ts --plan
pnpm --dir apps/web exec tsx --test '../../tools/test/hosted-savings-bootstrap*.test.ts'
```

The plan verifies repository schema sources only; no database is contacted.
When separately authorized to create a disposable local database:

```sh
pnpm --dir apps/web exec tsx ../../tools/test/hosted-savings-bootstrap-cli.ts --fresh-disposable-local
```

This delegates to the existing manifest verifier, chronological materializer and
owned Supabase replay runner. The runner applies the first 125 bootstrap sources
through local Supabase migrations, verifies their ledger, then applies source 126
onward. This is verified bootstrap accounting, not the temporary loader's 1087
resume offset. The mandatory full-schema SQL check causes the existing runner to
apply post-replay/current pending sources using its existing replacement rules.
Counts in the plan are source counts, not a promise that superseded bodies run.

No destination URL, existing database, offset or resume is accepted. Execution
uses a sanitized child environment pinned to a validated local Unix socket
(/var/run/docker.sock or the current user's default Colima socket); the engine
allocates fresh project resources, validates the loopback DB destination and
cleans up owned resources on completion/failure. No production database capture,
seed data, credentials, deployment or persistent service setup is performed.
The engine reads checked-in schema/effect fixtures; classify mode records effect
differences and does not certify production equivalence. Historical SQL can
contain migration-owned data changes; this is not a customer-data import.

Limitations: this is a disposable rehearsal, not a persistent hosted bootstrap.
It requires the existing pinned CLI/PostgreSQL contract, Docker socket and local
Git history/manifest artifacts. A fresh replay can still fail on historical SQL,
extension prerequisites, manifest drift or the full-schema check; it stops and
does not resume. Tests exercise orchestration and rejection boundaries, not a
fresh PostgreSQL replay. Auth/REST, synthetic OTP users, mail, egress isolation and
hosted service lifecycle remain separate prerequisites. Do not expose this stack
or interpret schema success as provider readiness.

The earlier registry mismatch was resolved through the reviewed registry workflow;
the read-only plan now passes. Fresh execution requires at least 20 GiB free on
the repository filesystem before launching the worker, and checks again inside
the worker. This conservative floor is not a measured peak-space guarantee and
does not replace checking VM storage and image availability. No automatic cleanup
or fallback to another host is performed. See hosted-savings-bootstrap-evidence.md
for the current blocked rehearsal and exact source hashes.
