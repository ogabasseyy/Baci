# Reviewed restricted runtime preparation

This prepares credentials, not card payments. Original-signature intake is live
and independently verified. The old replay container still uses expired JWTs;
this installer prepares replacements without swapping that container, claiming
receipts, enrolling the goal or starting services.

## Owner command

Run on the Mac:

```sh
/bin/sh /Users/mac/Baci-worktrees/cursor-savings-phase1/tools/staging/prefunded-card/activation-runtime-prepare.sh
```

The launcher sends a literal pinned bootstrap over SSH, rather than executing the
mutable VPS `owner-command.txt` as the source of its root checksum. The root copy
verifies every artifact before execution. VPS bundle:
`/home/bassey/baci-runtime-preparation-20260927-r3`.

- Runner: `196a683faaad63f0b3bb14d912e241f2ff37379d6bbc2978270a6b729c892b00`
- Checksum list: `a105c8166a3d1cc6d943c2a2058252420a1fea6f157a7dee5f035e075a2d1004`
- Reviewed CJS: `b8c01f0195820b7a7aed9c2093ec3bb7c6528251d4f5a954fdb1acac18ba0540`

Owner execution returned `RESTRICTED_RUNTIME_PREPARED` successfully. Audit:
`/root/baci-runtime-preparation.JeOlVsRk`. The actual configuration digest is
`cfb35ec18c79d1d700948ca493692d54efc7c53c4e22ca38a1ffe0fa138108e3`.
No further preparation retry is required.
Uploaded hashes and shell syntax were verified. The first bundle committed role
provisioning, then refused at `restricted-tls-readiness`; its audit is retained at
`/root/baci-runtime-preparation.wDArxv3w`. Do not delete its credentials or retry
the old bundle. R2 also refused at readiness, with audit retained at
`/root/baci-runtime-preparation.3AoPYYvK`.

R3 fixes a second, independently reproduced boundary defect: the private file
reader returned schema-transformed output, then readiness reparsed it as raw
input. Injected background/replay database `profile` fields are rightly rejected
by the raw strict schema. No connection was attempted. The reader now retains
the bounded original source only after successful validation, and the CLI passes
that source to readiness. Existing consumers still receive the validated output.
Do not reparse transformed output as raw configuration or weaken the strict schema.

Failures inside the restricted executor now retain only fixed profile/phase labels
and allowlisted error codes. CLI and owner wrapper preserve those safe diagnostics,
never raw error messages, queries, paths or credential values. An unused diagnostic
draft was staged during investigation; it was not executed and is not the owner
handoff. Use only the R3 command above.

The exact session query independently reproduced SQLSTATE 42803: `pg_roles` is a
view, so grouping only its OID did not permit selecting ungrouped role flags. R2
groups every selected role flag, with no policy changes. The authorizer profile
also lacked the exact parameterless `SELECT true` used by readiness; R2 permits
that read only, retaining its existing financial-operation allowlist. All three
corrected role queries passed against the live database in rolled-back read-only
sessions. This is not yet proof of the password/TLS path; the owner retry proves it.

## Effects and safeguards

- Reads existing approved staging CA, PiggyVest and Paystack test credentials.
- Verifies both database identities, the Compose project label and old replay
  token HMACs/audiences. The label is not a substitute for physical DB identity.
- Saves unique restricted passwords and a retry proof as root-only `0600` files
  under `/etc/baci/prefunded-card`. Existing foreign files are not replaced.
- Transactionally enables only three existing executor logins, with unchanged
  grants/memberships and fixed expiry. The baseline must retain the approved
  10,000-kobo treasury and migrated customer's NGN 100, with no operations,
  checkout intents or canonical credit route.
- Proves TLS and role identities with the application's restricted executor;
  readiness only executes identity/session checks and `SELECT true`.
- Writes `activation.prepared.json` and `replay-base.prepared.json`. It does not
  install signing keys in the replay worker or fabricate provider signatures.

No charge, transfer, balance update, snapshot refresh, service restart, public
route change, goal enrollment or lease extension occurs. Expiry remains
`2026-09-29T15:59:10Z`; approved company budget remains 10,000 kobo.

## Retry and remaining gates

Passwords/proof persist before the role transaction. Initial runs reject foreign
LOGIN state. Retry requires the same proof and exact expiry, without rotating
passwords; TLS checks reject changed credentials. A lock serializes owner runs.

An ambiguous database failure reports `databasePrepared: null`. Preserve the
root audit directory and private files; inspect the stage before retrying. Do
not delete/recreate credentials to bypass refusal. Protected replay/enrollment
cutover, recurring independent snapshots, authenticated checkout deployment and
a genuine signed settlement test remain. Prepared tokens do not themselves
restore the old replay worker.

## Validation

35 focused owner/config/package/CLI Python tests pass. Regression coverage now
includes actual TLS/SCRAM for all three roles, wrong-password/wrong-CA refusals,
and the entire compiled CLI private-file-to-connection path. The complete CLI
test reproduced the R2 failure before the source-handoff fix. 55 focused Vitest
tests pass. The compiled CLI matches its refreshed reviewed
digest. The package now hashes and publishes the same captured CJS bytes, closing
a replacement-between-reads race with a regression test. Monorepo typecheck
passes six tasks; full lint remains blocked by unrelated existing mobile
findings. CodeRabbit refused this directory's existing 153-file scope (limit 150)
and did not complete this revision's review.

Owner execution now confirms live restricted password/TLS readiness. Its report
explicitly keeps card payments, prefunded replay, live replay replacement and
service starts false. This is not a card-activation or settlement claim.

Terra independently ran all five PostgreSQL integration tests green, including
the complete CLI regression red-before/green-after, and reviewed R3 source with
no remaining high-risk blockers. The parent verified uploaded R3 hashes and
launcher quoting; Terra did not independently attest remote artifacts.
