# Source-only final integration acceptance report

Owned files are confined to this new directory. The reporter reads local files,
checks SHA-256 pins and the 25-file contract harness seal, and prints one report.
It does not execute sibling modules, tests, SQL, providers, devices or mutations.
No dependencies, build, install or configuration changes are needed.

From the canonical checkout:

```sh
node tools/staging/interest-bridge/integration-acceptance/report.mjs
```

Exit0 means bounded source evidence is ready, **not** actual integration acceptance.
Exit1 means invalid input or missing/drifted required source/test evidence.
`FINAL.md` is the finish checklist and PiggyVest copy-paste text from the pinned
local evidence. Re-run the read-only reporter if sibling evidence changes;
never automatically replace pins to make a failed report pass.

`evidence.json` is validated by `schemas/acceptance-schema.mjs`. Every record
requires a local repository path and SHA-256. Unknown fields, caller-provided
completion/verification booleans, mutation modes, unsafe paths, duplicate IDs,
and fixture evidence assigned to a live category are refused. Read-only is the
default. Missing files or incorrect contents/digests leave readiness pending.

`sourceIntegrationReady` covers the sealed contract harness and saved synthetic
result only. The 48 application inputs are represented by the old result's
aggregate digest without an entry list; their current closure is not reverified.
The 24 tests were reported in the existing handoff, not rerun by this sidecar.
Digest integrity proves artifact bytes, not the truth or freshness of live claims.
Auth/financial/provider/device attachments remain pending independent current
verification, even when a JSON attachment contains `verified: true`.
`actualAcceptance.status` always remains pending in this source-only reporter;
it cannot certify actual provider or device acceptance from a boolean or fixture.

The historical missing-evidence JSON is retained as historical context, not a
claim that its old blockers are current. Parent's latest r8 active/r2 failed,
read-only recovery and new empty-goal facts are labeled user-supplied context.
They supersede older narratives for context but do not create live evidence.

Parent-owned validation commands (not executed by this sidecar):

```sh
pnpm exec node --test tools/staging/interest-bridge/integration-acceptance/report.test.mjs tools/staging/interest-bridge/integration-acceptance/schemas/acceptance-schema.test.mjs
pnpm exec biome check tools/staging/interest-bridge/integration-acceptance
pnpm turbo lint
pnpm turbo typecheck
pnpm turbo test
```

The new colocated tests cover readiness with acceptance pending, omitted proofs,
corrupt pins/source, synthetic delivery promotion, incorrect economics/duplicate
credit, stale live notes, conservative defaults and exact authority constraints.
Parent owns their execution, CodeRabbit review and global audit.
