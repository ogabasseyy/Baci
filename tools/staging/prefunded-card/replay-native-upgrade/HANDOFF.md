# Frozen native replay factory: source-only handoff

## Build contract

Only six production overlays from the frozen Dirac inventory are permitted. The canonical runtime entry remains `apps/web/src/lib/piggyvest/prefunded-card-replay-runtime.ts`, exporting only `createPrefundedCardReplayRuntime`. No canonical source is written. Both new signed-outflow files are resolved virtually at their canonical paths; their canonical files must be absent before and after compilation. Null original hashes are forbidden for the other four files.

Frozen inventory: `/Users/mac/.codex/worktrees/0d77/Baci-app/tools/staging/prefunded-card/signed-transfer-replay-source/source-hashes.json`.

Inventory SHA256: `9c7f0cc338b057758b3c123a6b4c345c11a6f83270ed0f90642ec430f95f4fc2`.

The builder checks all frozen review/harness receiver files too, but overlays **only** `productionDelta`. The INGEST overlay `prefunded-card-provider-evidence.ts` is mandatory: it canonicalizes the initial observation category as well as the verified observation. Omitting it can cause SQL category/conflict rejection even with a correct normalizer.

Run locally after review, using the already-installed esbuild; no install or Next build:

```sh
umask 077
output_parent="$(mktemp -d /private/tmp/pvb-replay-native.XXXXXX)"
node /Users/mac/Baci-worktrees/cursor-savings-phase1/tools/staging/prefunded-card/replay-native-upgrade/build.mjs \
  /Users/mac/.codex/worktrees/0d77/Baci-app/tools/staging/prefunded-card/signed-transfer-replay-source/source-hashes.json \
  9c7f0cc338b057758b3c123a6b4c345c11a6f83270ed0f90642ec430f95f4fc2 \
  "$output_parent/artifact"
```

The child output must not exist. Directory/captures permissions are 0700; files 0600. The builder uses ESM, Node 22 target, the `createRequire(import.meta.url)` banner and only `pg-native` external plus Node builtins. Package/source allowlists exactly follow worker-renewal policy SHA256 `60d398d516089193838bef6817d8aa0538db27d5e789e64cee116d303b6ddc40`. Host Node version is recorded separately; targeting Node 22 is not proof of execution on Node 22.

Outputs: `prefunded-replay-bundle.mjs`, `manifest.json`, `metafile.json`, original `inventory.json`, `virtual-entry.ts`, and content-addressed `captures/<sha256>.source`. Captures include compiled bytes, original overlay bytes, compiler binaries/package metadata, build controls, and frozen receiver review/harness bytes. `manifest.sources` records canonical before/after and receiver before/after hashes; the two absent originals are null. `manifest.observed` records every observed file and absence. Source drift, unused overlays, packages/externals outside policy, aliases and changed inventory refuse publication. No runtime factory is invoked.

## Stable interfaces for Dirac's separate owner helper

`verifyArtifact` from `artifact.mjs` is pure and receives:

```js
{
  manifestBytes, reviewedManifestSha256, bundleBytes,
  inventoryBytes, metafileBytes, virtualEntryBytes,
  captures: new Map([[sha256, sourceBytes]])
}
```

All bytes must be Buffers. Capture keys are bare lowercase SHA256 values, without `captures/` or `.source`. Missing/extra/tampered captures, widened scope, changed predecessors, changed graph or omitted overlays refuse. Success returns `{ manifest, bundleSha256, manifestSha256 }`. The independently reviewed manifest pin is supplied separately, not self-approved from the received manifest.

`prepareUpgrade` from `upgrade.mjs` is pure and receives exactly:

```js
{
  predecessorBytes: { bundle, daemon, config, private },
  artifact: { /* the exact verifyArtifact inputs */ }
}
```

It first hashes the actual four installed predecessor byte buffers, then verifies the reviewed artifact, then prepares configuration. Returns `{ files, pins, installed:false, providerCalled:false, sqlExecuted:false }`. `files` has `prefunded-replay-bundle.mjs`, `config.json`, and an exact byte-identical `prefunded.json`. Only `config.json.prefundedReplay.bundleSha256` changes semantically. Serialization changes its byte hash, returned as `pins.next.config`; daemon and private hashes remain unchanged. No files are installed or written by this function. Do not call the lower-level configuration helper instead of this predecessor gate.

Installed ABI remains strict six-field `scope`: `environment`, `integrationId`, `merchantId`, `treasuryBindingId`, `businessId`, `expectedSystemId`. No batch size or expiry is inserted. Physical AppDB is `7685292944002592802`; receipt DB is `7686901100561231906`. Existing token values, role/audience/expiry, evidence settings and database profiles are preserved. Fixed deadline is `2026-10-06T15:59:10Z` (1791302350). Token payload checks do **not** independently verify JWT signatures; exact installed byte pins and parent's existing signed-credential validation remain required.

## Exact predecessor gates

| Input | SHA256 |
| --- | --- |
| Factory | `de2959f583189688a1bb8cf02153325ef314e68c6dded71d7bbce3c832057500` |
| Daemon | `02420ef54fe4061cb676ae01003acf4ed9c9280d22a1b3ca0d05e94bd9fe1457` |
| Activation config | `968499d8e16c83d7e9cd28c5d35cd380bf8d5dff72445ceda3bb2ab79ad8f980` |
| Private config | `a2356c72a4dbf7e2651c518dc97652733a2699f9321e7a60b848c771cb92a6f0` |
| Installed r8 replay source manifest | `06957f1972dc677da9191b0164953d7f29333f6b619a02f24f6d80b89220a8f3` |

Parent reports all 30 original canonical source inputs independently match the installed r8 manifest, changed=[]; this kit records that baseline identity but does not manufacture a local capture of the root manifest. Parent's owner helper must recapture/check that manifest and its closure before installation. Keep old r8 seals immutable; record the six overlays and compiled output in an additive chain.

## Parent-only installation and replay gates

1. Independently review the new manifest/bundle and pin its hash. Recheck frozen receiver/canonical originals against captured bytes, the installed source manifest, and compiler policy. No other graph delta inherits approval. Root input reads must reject symlinks, wrong ownership/mode and changed bytes; no config/credentials in logs.
2. Confirm quiescence, exact live predecessor bytes, Oct 6 time/credential bounds and unchanged restricted connectivity/SQL authority. A constructor/readiness check is not replay, evidence or completion proof.
3. Preserve root-owned 0600 backups of the exact predecessor bundle/config/daemon/private files and metadata before swapping. With services stopped, stage/verify both new files, swap factory plus digest-bound activation config as a pair, and rehash/readiness-check before resuming. File renames alone are not a two-file transaction; failure must restore the exact pair before any process runs. Do not rewrite daemon/private config, profiles, roles, SQL, timers' authority or old seals. Parent decides activation; this kit has no apply executor.
4. For original receipt `0f9938ae-8551-4e2e-8816-853e0231b2c3`, retain exact raw bytes, HMAC, encrypted receipt and fingerprint. Native `wallet_transfer` is translated to SQL `wallet-transfer` in both observations only through the exact schema/identity guards. Never re-sign/reserialize the receipt, rewrite event IDs or guess wallet/customer/reference aliases.
5. Native normalization still performs independent **read-only provider GETs** during actual replay (transaction proof and PUBLIC/FAAS/customer mapping). Building/verifying this kit performs none. Parent must authorize and validate that deployed replay separately. Stop on existing conflict or mismatching verified evidence; parent-reported `provider_evidence=[]` must remain a fresh checked precondition, not a fact assumed by this kit.
6. Stored outflow `processed` means evidence recorded, not funding. Existing restricted completion may consume exact verified stored transfer evidence, then a later existing projection step credits once. No second payment/transfer, no lease clearing, no fence reset, no new budget; old goal opening 10000 and company cap 10000 stay unchanged. No interest payout routing is inferred.

Local validation is only `node --test /Users/mac/Baci-worktrees/cursor-savings-phase1/tools/staging/prefunded-card/replay-native-upgrade/*.test.mjs`. Fixtures are synthetic and local; authentic predecessor positive preparation remains untested until parent supplies the actual pinned bytes. Parent owns global checks and all live effects.
