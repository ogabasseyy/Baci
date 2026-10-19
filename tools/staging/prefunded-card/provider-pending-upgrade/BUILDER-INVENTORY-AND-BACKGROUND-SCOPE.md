# Recorded builder inventory and separate background successor

This is an unsealed follow-up note. No sealed public kit, source snapshot, r8
seal, permanent SQL, provider source or compiled output was changed or rebuilt.
All VPS entries below are recovered from existing local records, not live
filesystem observations. Parent owns root-terminal recovery and verification.

## Concrete recorded VPS paths

| Recorded item | Exact path |
| --- | --- |
| Original Linux dependency cache | /home/bassey/baci-savings-funding-get-20260925/build/source/node_modules |
| Original web-specific dependency links | /home/bassey/baci-savings-funding-get-20260925/build/source/apps/web/node_modules |
| Cached Next package/version record | /home/bassey/baci-savings-funding-get-20260925/build/source/node_modules/next/package.json |
| Public build workspace | /home/bassey/baci-prefunded-public-20260928 |
| Public source tree | /home/bassey/baci-prefunded-public-20260928/source |
| Public copied Linux dependencies | /home/bassey/baci-prefunded-public-20260928/source/node_modules |
| Public Next build application | /home/bassey/baci-prefunded-public-20260928/source/apps/web |
| Public build log | /home/bassey/baci-prefunded-public-20260928/build.log |
| Public artifact packager | /home/bassey/baci-prefunded-public-20260928/public-artifact.py |
| Original public launcher | /home/bassey/baci-prefunded-public-20260928/launch-public.cjs |
| September final release | /home/bassey/baci-prefunded-public-20260928/artifact-v4 |
| October readonly release staging | /home/bassey/baci-first-card-readonly-artifact-20261002 |
| Readonly archive | /home/bassey/baci-first-card-readonly-artifact-20261002/public-app.tar.gz |
| Readonly archive manifest | /home/bassey/baci-first-card-readonly-artifact-20261002/public-app.manifest.json |
| Readonly source manifest | /home/bassey/baci-first-card-readonly-artifact-20261002/source-manifest.json |
| Readonly launcher staging filename | /home/bassey/baci-first-card-readonly-artifact-20261002/launch-public-readonly.cjs |
| Current r8 root bundle recorded by parent | /root/baci-financial-owner.2ynkl9kc/bundle-r8 |
| r8 retained public archive manifest | /root/baci-financial-owner.2ynkl9kc/bundle-r8/public/public-app.manifest.json |
| r8 retained public source manifest | /root/baci-financial-owner.2ynkl9kc/bundle-r8/public/source-manifest.json |
| Installed public application | /opt/baci-prefunded-public/app |

The earlier /home/bassey/baci-first-card-artifact-20261002 path is an isolated
October predecessor, not proof of the installed readonly release. The local
record explicitly stages the readonly archive in the separate readonly-artifact
directory above. Parent must match actual files to the original immutable pins:
archive 882f0fd9d436a8117a48df1ae45bb4dba95d43da2c28b3a7f1d7c7e379cea1b2,
manifest 42b5f4e5f457ccea7fa1b61192251b60e0b8f01b05858fc2220b1944b5de62d8,
source manifest 4b066d0e957b4f029c1be1e5c71c1496e269600d1763414645882d832c5c07d7,
launcher d0d0a249a940f9783cc2d8784868ca776c65f2e060ca4095736e4fea70b61f03.

## Original source-readonly-r2 and image evidence

The exact full source tree recorded locally is
/private/tmp/baci-first-card-build-20261002.FUTQPHUB/source-readonly-r2.
Its manifest is
/private/tmp/baci-first-card-build-20261002.FUTQPHUB/source-readonly-r2/source-manifest.json.
Its built release is
/private/tmp/baci-first-card-build-20261002.FUTQPHUB/release-readonly.
The containing local build directory is absent now. The known VPS readonly
staging and r8 bundle retain the source manifest; this does not prove either
contains the complete source tree. No VPS source-readonly-r2 directory is invented
here. Recovery must reproduce every source, generated file and rewrite hash.

The recorded original VPS build runs native /usr/bin/node from
/home/bassey/baci-prefunded-public-20260928/source/apps/web with
`node ../../node_modules/next/dist/bin/next build --webpack`, logging to the exact
build.log above. It is not recorded as a containerized Next build.

The concrete recorded runtime/smoke image is
sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553.
It appears in the September smoke protocol and public_service_contract.py.
That proves a recorded runtime/smoke identity, not the identity of a separate
compiler image. Parent must attest any compiler image before using it.
The copied Linux dependency tree was measured at 2.9G in the old record; neither
its current size nor its integrity is reverified here. The sealed kit's 1 GiB
cache gate would refuse that historical size. No capacity gate is relaxed by
this inventory; parent must separately review a bounded cache/build approach.

## Evidence locations

The existing local protocol record is
/Users/mac/.codex/sessions/2026/09/18/rollout-2026-09-18T15-44-45-01a09002-424a-7832-bd7f-a592fe712ac9_01a0b4fa-1de0-78e1-8a33-99968b965a4b.jsonl.
Relevant records: 44506/44511 dependency paths, 44624/44631 copied cache and size,
44639 native build command, 44704 packager, 44979/45070 smoke image,
63481 source-readonly-r2, 63540/63546 readonly staging paths and hashes.
Parent scripts /private/tmp/baci-financial-activate-r8-parent-20261002.py and
/private/tmp/baci-financial-activate-r8-6-parent-20261002.py record the r8 root
bundle path. financial-activation/prepare.py records the two public manifests
copied into that bundle; it does not copy the full public TypeScript source tree.

## Expanded background successor scope

Parent now reports an authenticated successful rich TSQ response with
third_party_reference and businesscustomer. That is a new runtime observation;
the sealed kit's earlier no-transfer note is historical, not a current financial
baseline. This sidecar makes no provider request and independently claims no
transfer or canonical projection outcome.

Helmholtz owns the TSQ root-cause helper and source tests. Freeze his reviewed
normalization, corroborating authenticated wallet GETs, business/customer/wallet
crosswalk, amount/currency/reference/identity checks and error behavior before
building the separate background successor. Missing nonexistent normalized
response fields must not be accepted as identity proof; unrelated or incomplete
wallet evidence must fail closed. Review actual success, mismatch and unavailable
corroboration tests together with the new helper's complete static graph.

Known background source chain:
apps/web/src/scripts/run-prefunded-card-background.ts ->
apps/web/src/lib/piggyvest/prefunded-card-composition.ts ->
apps/web/src/lib/piggyvest/prefunded-card-execution.ts ->
apps/web/src/lib/piggyvest/prefunded-card-provider.ts.
The expanded closure must include the finalized TSQ helper, schemas, wallet-read
adapter/crosswalk dependencies and their package inputs. Existing archived worker
hashes are predecessors, not authority for that expanded successor.

Franklin's separate additive claim-boundary migration is
supabase/migrations/20261002160000_prefunded_first_card_claim_boundary.sql.
His requirements are recorded in
tools/staging/prefunded-card/checkout-claim-boundary-HANDOFF.md. Parent must capture
actual predecessor bodies/catalog fingerprints for claim_due and
claim_reconciliation, rehearse the exact bounded migration with rollback, then
review a new SQL installation chain. Old dispatch/storage SQL and r8 seals remain
immutable. The new SQL fence does not normalize TSQ; the TypeScript helper does
not install the SQL fence. Both are independently reviewed activation gates.

The background successor needs its own complete old/new source/artifact pins and
additive chain referencing the original r8 ancestor and actual current parent
head. Preserve the one-line public-provider chain separately. Any shared source
dependency overlap must be explicit in a reviewed combined or sequential chain;
ambient worktree changes never enter either sealed build.

Before parent resumes dispatch, capture fresh protected state after all latest
collection/promotion/transfer observations, drain inflight work, preserve existing
leases/fences/history, prove installed SQL and mounted background bytes, and
review TSQ/wallet/crosswalk correctness. A compilation or successful TSQ response
alone does not prove canonical savings credit. Do not retry a completed payment,
reset an operation, change a principal/reserve or execute a transfer here.

## Frozen public kit

/private/tmp/baci-provider-next-source-kit-20261002-808c042c-995e-4b16-9bb5-cb25245bb8d2/source-kit.tar.gz
remains SHA256 8b52ee5571497e2ed23baa5f9826ddfadbe12244671cbc1500fd257f576d62d6.
Its next-kit.json remains SHA256
fdfd3961752bc6e6b23c65128db7d581a67b8587dc184250ef7c84e0986942c1.
This follow-up note is outside that sealed kit. No rebuild, reseal, root action,
live deployment, SQL execution or provider/payment operation occurred here.
