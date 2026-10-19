# First-card week renewal preparation

`root-collect.py` runs both read-only SQL projections in the owner host's
existing staging DB containers, normalizes them, pins the live installed files
and relevant systemd units, and stages byte-identical inputs. `rebuild.py`
then creates a private expiry-only candidate bundle. Neither helper connects
to production, installs files, executes SQL, reloads services, changes a live
flag, or starts a payment. Runtime contents are never printed.

## Read-only collection contract

Run `root-collect.py` as root on the isolated staging host. It performs the
queries itself and writes a fresh UTC timestamp, normalized target checkout and
retirement evidence, exact routine and constraint metadata, receipt DB pins,
file hashes and deadline occurrence counts, service state, and private staged
copies. It deliberately does not require the three DB roles to be renewed or
runtime tokens/claims to be currently valid: those conditions belong to
activation, not expiry-rebuild preparation. Installed service state remains
visible in metadata so configured flags are not confused with a running
service. The collector does not output credentials or config contents.

The app projection must preserve the retired intent and operation, the single
retirement audit's before-state fingerprints, zero other intent/operation
counts, 10,000-kobo principal and company budget, and zero reserved/consumed
treasury. Do not include receipt bodies, credentials, DSNs, token strings,
private keys, provider responses, or SQL text containing customer data.
`sealed-source.json` independently pins the five routine predecessor
definitions, owner, language, security-definer setting, `search_path`, ACL,
and source hashes. The reserve retirement compatibility change is constructed
from only two exact slots in the sealed reserve SQL; no helper imports the
12-file retirement-patch loader. These pins are not populated from inventory.
Receipt JSON's `deadline` is renewed only at its exact pinned artifact path;
other JSON uses only the explicitly recognized expiry keys. The public service
unit candidate changes exactly one `ExecCondition` epoch from `1790697550` to
`1791302350`; all other service-file bytes remain unchanged. It is staged as a
candidate only and is never started or reloaded.

## Exact commands

From the staged helper directory on the root host, collect and then build:

```sh
umask 077
python3 root-collect.py \
  --output /home/bassey/baci-card-week-renewal-20261002-baseline.json \
  --artifacts /home/bassey/baci-card-week-renewal-20261002-input
python3 collector.py /home/bassey/baci-card-week-renewal-20261002-baseline.json
python3 rebuild.py \
  --baseline /home/bassey/baci-card-week-renewal-20261002-baseline.json \
  --artifacts /home/bassey/baci-card-week-renewal-20261002-input \
  --repo-root "$PWD/../../../.." \
  --output /home/bassey/baci-card-week-renewal-20261002-candidate
```

Success creates `candidate.json`, guarded `database-renewal.sql`, JSON config
copies with only recognized expiry fields changed, three deadline timer
candidates (including the public service condition), and a first-card-only
endpoint env candidate. Compiled `.cjs` and
`.mjs` files are hash-verified but deliberately excluded from byte patching;
their source must be rebuilt and reviewed before any activation bundle exists.
The manifest lists them under `sourceRebuildRequired`. The builder
requires a fresh baseline (at most five minutes old), exact app/receipt system
IDs, matching current function OID/owner/ACL/definer/language/config/body pins,
the exact expiry constraint OID/hash, and byte hashes matching the staged
installed files. It records service activity and the observed configured
first-card flag separately; neither an expired runtime token nor renewed role
credentials are prerequisites for expiry-only candidate construction. The
first-card endpoint env candidate explicitly sets
`PREFUNDED_CARD_CHECKOUT_MUTATIONS_ENABLED=false`. Runtime behavior must be
verified as an unauthenticated/authenticated GET with checkout disabled and
maximum amount zero, plus a CSRF-protected POST/PATCH refusal (503) before
database/provider work. The checkout-public flag alone is not safe to start
while financial workers remain off, and candidates with mutations enabled or
unspecified are refused. Full-chain activation must separately opt in later.
It preserves the retired intent's old expiry and retirement state, caps the
company budget at 10,000 kobo, edits only the first-card endpoint flag, and
does not alter saved-card or auto-debit settings.
The SQL is not executed by this command. Review/rehearse it separately before
any installation; no payment is part of renewal preparation. Because the SQL
pins UTC explicitly, any earlier rehearsal hash is stale and must not be
reused.

## Fresh public bundle

After the root collector and builder produce a fresh candidate, `activation_bundle.py`
validates the actual public archive/manifest, standalone launcher, 56-file Next
source closure, compiled worker artifact hashes, first-card-only/default-deny flags, and a
rollback rehearsal record bound to that exact SQL hash. It assembles the public
app and renewed public configs alongside workers marked inactive. It does not
install, commit SQL, start a unit, send a request, or enable card readiness.

The rehearsal record is a private JSON file with exactly these fields:

```json
{"status":"rollback_rehearsal_passed","databaseSqlSha256":"<candidate SQL SHA256>","exitCode":0,"rollbackConfirmed":true,"protectedStateUnchanged":true,"committed":false,"newPaymentStarted":false}
```

Once the parent has staged the fresh post-UTC candidate and rehearsal record,
assemble the bundle with:

```sh
python3 activation_bundle.py \
  --candidate /root/<fresh-candidate>/candidate \
  --archive /home/bassey/baci-first-card-artifact-20261002/public-app.tar.gz \
  --manifest /home/bassey/baci-first-card-artifact-20261002/public-app.manifest.json \
  --source-manifest /home/bassey/baci-first-card-artifact-20261002/source-manifest.json \
  --launcher /home/bassey/baci-first-card-artifact-20261002/launch-public.cjs \
  --worker-root /home/bassey/prefunded-card-worker-renewal-20261002-r2 \
  --rehearsal /root/<fresh-candidate>/rehearsal.json \
  --output /root/<fresh-candidate>/activation-bundle
```

The result remains `prepared-inactive`: public service startup, TLS/unauthenticated/
authenticated GET proof, and a public rollback owner are separate execution steps.
Financial background, snapshot, readiness, and replay workers are not enabled by
this helper; payment end-to-end readiness remains false.

## Focused tests

```sh
python3 app-baseline.test.py
python3 receipt-baseline.test.py
python3 runtime_artifacts.test.py
python3 root-collect.test.py
python3 collector.test.py
python3 rebuild.test.py
python3 activation_bundle.test.py
python3 database_sql.test.py
python3 mixed_public_contract.test.py
```

## Current blocker

No live candidate is generated until the helper is run with root access on the
staging host. This workspace has not attempted the live collection or changed
runtime/database state.
