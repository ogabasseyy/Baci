# Hosted isolated catalogue fixture

Local tooling only. No remote action has been performed. Parent must review and
run `--dry-run` successfully before considering `--seed-reviewed`. PostgreSQL
execution is not covered by the local source/contract tests.

The fixture reproduces the catalogue shape from the reviewed local
`/tmp/baci-savings-local.LfiKp5/seed.mjs`, but does not copy its Auth account file,
enable savings, insert a wallet, upsert collisions, or send a schema notification.
It creates one synthetic merchant, one linked customer, one product and two
variants. All boolean merchant feature settings are explicitly false and checked
before commit. Product prices are synthetic catalogue values, not money movements.

## Required parent preparation

- Use the official isolated Auth service to create exactly two synthetic accounts:
  `owner@savings.example.invalid` and `customer@savings.example.invalid`. Do not
  hand-insert Auth rows, copy sessions, or put passwords/tokens in fixture input.
  Account provisioning is deliberately not implemented by this SQL seeder.
- Stop/pause Auth, REST and all other application peers for maintenance. Existing
  installer Docker guards still require an owned internal network with no active
  peers, no exposed database ports, exact immutable container/image IDs, and a
  local Unix Docker socket. Remote Docker/DSNs are not accepted.
- Keep cron disabled, pg_net targeting a nonexistent database, Vault empty and
  the previously reviewed event-trigger containment in place. The seeder does
  not disable triggers or change any of those settings.
- Retain the complete verified SQL bundle on the execution host. The intentionally
  incomplete Mac materialization directory will fail verification.
- Review a JSON input object with exactly these properties:
  `destination` (the existing full installer destination contract),
  `installed` (the successful install receipt object), `systemIdentifier`
  (decimal string), `ownerId`, `customerActorId`, `fixtureReviewed: true`.
  The installed receipt container/image/manifest must match destination, and its
  completed count and every current journal row must match the verified bundle.

## Commands after parent review

Use the existing TS runtime/bundling mechanism; do not install dependencies.
For Node 24 from the worktree, this resolve hook supports the existing extensionless
imports without producing a bundle or cache:

```sh
node --import 'data:text/javascript,import {registerHooks} from "node:module";registerHooks({resolve(specifier,context,nextResolve){try{return nextResolve(specifier,context)}catch(error){if(specifier.startsWith(".")&&!specifier.endsWith(".ts"))return nextResolve(specifier+".ts",context);throw error}}});' tools/test/hosted-savings-fixture.ts --dry-run /private/reviewed-fixture-input.json /private/complete-reviewed-bundle
```

Only after real rollback rehearsal and parent commit approval, use the identical
command with `--seed-reviewed`. Both modes perform the same checks and writes;
only the final transaction terminator differs. A repeat after successful seeding
fails collision checks; there is no upsert, reset, resume, or automatic cleanup.
Only hashes, destination identity and status are emitted; SQL error payloads are
redacted. Retain successful stdout as the parent-owned evidence receipt.

## Side effects and remaining runtime proof

Normal schema triggers remain active: merchant insertion creates its feature row,
variant insertion can rebuild product metadata, and catalogue/feature triggers can
enqueue scoped cache invalidation work. Those local outbox rows are not delivered
by this tool; keep all workers disabled. Nonempty pg_net request queues are rejected
before and after writes. Existing Auth data, principals and memberships must match
the installer snapshots exactly. Wallets, goals, drafts, draft scopes and PiggyVest
integration registrations must remain absent. Unknown schema incompatibilities or
trigger-produced forbidden rows fail the transaction rather than being bypassed.
No real PostgreSQL rehearsal or external-effect delivery test has run here.

## Hosted drafts remain disabled

`20260913120000_customer_savings_draft_storage.sql` constrains settings to
`local_test`, and its `visible` function requires that environment. The draft
command relies on that function. A new append-only migration must introduce a
separate disabled-by-default hosted binding, scoped to the explicitly approved
isolated runtime and merchant, and update the visibility/command authorization
without broadening local permissions. No hosted binding or enabled row is seeded.

Canonical goal creation separately requires the local socket/login boundary in
`20260913140000_customer_savings_canonical_isolation.sql`; canonical binding in
`20260913130000_customer_savings_canonical_binding.sql` additionally targets
`piggyvest_local`. Do not repurpose these for hosted execution. Funding, policy
activation, provider integration and canonical goals remain outside this fixture.
