# Optional prefunded durable replay seam

Code only, not activated or deployed. No tests, typechecks, formatters, builds,
provider requests or background jobs ran during this performance window.
Existing changed files were preserved under
`/private/tmp/prefunded-replay-seam-1790448813675-m6t74e` before editing.

## Injection

`runConfiguredReplayPass(configuration, { prefundedReplay })` forwards the same
optional callback bundle through `runReplayPass` and `createDurableReplayAdapters`
to the receipt worker. The CLI now calls `runReplayEntrypoint`, which constructs
this bundle only when the main configuration explicitly enables the pinned
`prefundedReplay` settings described below. No cross-worktree runtime import or
executor/role expansion was added. None of this source has been installed.

`PrefundedReceiptReplay` has three members:

- `resolveEnrollment({ receiptId, payloadSha256, eventId, eventType,
  providerCustomerId, rawPayload })` returns `enrolled`, `legacy` or `deferred`.
  This must independently query the provisioned integration/goal/operation registry;
  event identifiers are hints, not enrollment authority. Check both original
  envelope and inner destination identities plus bridge references. A failed,
  missing or ambiguous lookup must not return `legacy`. Only a positively scoped
  non-enrolled result permits the preexisting routing.
- `readOriginalSignature({ receiptId, payloadSha256, claimToken })` optionally
  returns `{ receiptId, payloadSha256, signature }` or null from an independently
  provisioned durable original-signature source. Returned receipt ID and digest
  must exactly match the lease. When `prefundedReplay` exists without an explicit
  reader override, `createDurableReplayAdapters` now supplies the receipt-store
  `createReplaySignatureReader`. It calls only
  `read_piggyvest_staging_receipt_signature(p_receipt_id,p_payload_sha256,p_claim_token)`.
  The private transport permits that RPC only on the receipt target. An explicit
  override is preserved. Null, mismatched or malformed results and storage failures
  retry without legacy credit; original ASCII hex casing is preserved.
- `replay({ rawPayload, signature })` is the callable adapter with the savings
  `createPrefundedCardReceiptReplay` contract, supplied by same-runtime composition.
  The receiver imports only its local callback interface. Bytes are copied directly
  from authenticated AES-GCM decryption after digest/event-ID checks, never from
  JSON reserialization. Copies isolate enrollment callbacks from replay bytes.

The seam runs before legacy inflow mapping and before wallet-transfer dispatch.
It does not intercept interest or bank-outflow finality. Once enrollment is known,
all evidence outcomes are terminal for that routing decision: applied/duplicate
resolve the receipt, retry/errors retain existing backoff, rejected/conflicting
evidence uses fenced poison/conflict quarantine. A stored wallet-transfer receipt
may be processed with `not_applicable` projection; a bank receipt may not.
Existing lease-CAS failure accounting and SQL attempt/dead-letter policy remain
unchanged. No extra claim, renewal, retry loop or callback retry is introduced.

## Signature source implemented; installation inactive

Parent's additive `receipt-signature-storage.sql` source now defines a separate
append-only original-header table, atomic
`accept_signed_piggyvest_staging_receipt(...,p_original_signature)` and the scoped
signature-read RPC above. The signed acceptance result includes `signatureStored:true`.
`intake-handler.ts` now passes the authenticated original `x-pvb-signature` unchanged;
`intake-persist.ts` uses the mandatory signed RPC, and the handler requires that
acknowledgement before reporting durable acceptance. These parent-owned files were
read as source references, not modified by the receiver reader/documentation lane.

The stored header preserves its original 128 ASCII hex characters, including case.
Authentic redelivery can append signature provenance to an existing receipt without
replacing its ciphertext. The read function selects the latest stored captured
header for rotation and requires the exact receipt/digest/token, `processing` status
and an unexpired lease. Its application EXECUTE grant is restricted to
`pvb_staging_worker`; the app transport does not inherit this RPC.

No signature schema has been applied or provisioning executed, and the new source
and regression tests remain unrun. Source implementation is not an installed or
active integration. An installation lacking the RPC remains retryable; historical
receipts without an authentic stored header return null after installation and
remain retryable without unverified credit. Such receipts need authentic redelivery
or separately approved authentic archive recovery. AES-GCM authentication does not
replace the provider HMAC, and computing a new HMAC is not provenance recovery.

## Opt-in runtime source

The main `/run/pvb-replay/config.json` may contain only these two activation
settings under `prefundedReplay`: `bundleSha256` and `configurationSha256`.
They are SHA-256 digests of the exact built module and credential-file bytes,
not caller-selectable URLs or paths. `readReplayConfiguration` applies the same
root-owned, bounded protected-file contract to this activation file before any
branch is selected; malformed or unsafe files never mean disabled activation.
When the field is absent from a valid protected configuration, the runtime does not
load the new module or its credentials. When present but invalid, loading fails
before receipt replay; it never retries the same pass through the legacy path.

`replay-prefunded-loader.ts` reads `/run/pvb-replay/prefunded.json` and the fixed
`prefunded-replay-bundle.mjs` sibling of the built daemon. Each ancestor must be
root-owned, non-symlinked and not group/world-writable. Files must be root-owned,
single-link regular files with approved modes and bounded, stable byte counts.
Credentials allow 0400, 0440 or 0600; code additionally allows 0640 or 0644.
Both digests must match before importing the module. Root-controlled installation
and the main daemon/configuration remain trusted deployment prerequisites.

The savings factory `createPrefundedCardReplayRuntime` exposes only
`resolveEnrollment` and `replay`. Configuration contains `scope`, `evidence`,
and `database: { treasury, ingestion }`. It requires the receiver's pinned app
database identifier across both restricted connections, the evidence configuration
and the integration scope, plus matching physical connection settings. Its async
startup awaits a read-only readiness query through both restricted executors
before returning any callback to the receiver. Their actual database/session
identity checks run before that query and again inside subsequent transactions.
Invalid scope configuration causes no I/O; successful startup performs no claims,
financial operations or provider requests. A failing direct connection aborts the
pass before receipts can consume retry attempts. The receipt store
supplies the original-signature reader; it is not configurable here.

This replay-only factory does not construct a Paystack card-charging client,
authorization provisioner, customer handler or scheduled charge worker. It has
no Paystack charging secret setting. Evidence verification still needs the
PiggyVest staging API and webhook credentials. The database transport remains
the existing approved TLS contract (or the synthetic local-test Unix socket),
not a newly permitted raw Docker hostname or plaintext TCP connection.

`replay-artifact.ts` provides callable source for assembling the receiver daemon
and the canonical replay factory into sibling Node 24 ESM modules. Its manifest
and source checks are described in `replay-artifact.md`. There is no automatic
build, installer, credential provisioning or service activation. The builder and
loader tests are written but unrun.

## Remaining validation and activation gates

- Review, validate and apply the additive receipt-signature installation, its
  restricted grants, and mandatory signed-intake deployment as a coordinated change.
- Validate and provision the trusted enrollment registry and restricted roles
  with exact integration/goal/operation scope; ambiguous enrollment must not
  select legacy routing.
- Validate the source factories and artifact builder, then build and inspect the
  combined artifact. Provision approved restricted credentials and transport,
  create the exact-byte pins, and install the root-protected sibling files through
  a separately reviewed staging activation. The implementation alone does not
  prove the existing VPS provides that connection contract.
- Validate the bounded worker, signature persistence/rotation, lease CAS and the
  parent-owned savings public-wrapper source/tests after explicit release.

With the callback omitted, legacy routing is deliberately unchanged; enrolled SQL
must retain its fail-closed guard. Parent owns the savings wrapper integration and
its unrun SQL tests. No live provider, settlement or deployed end-to-end claim is made.

## Changed paths

Paths relative to `/Users/mac/.codex/worktrees/0d77/Baci-app`:

```text
apps/web/tools/piggyvest-staging/replay-store.ts
apps/web/tools/piggyvest-staging/replay-private-fetch.ts
apps/web/tools/piggyvest-staging/replay-signature-reader.ts
apps/web/tools/piggyvest-staging/replay-signature-reader.test.ts
apps/web/tools/piggyvest-staging/replay-store-signature.test.ts
apps/web/tools/piggyvest-staging/replay-private-fetch-signature.test.ts
apps/web/tools/piggyvest-staging/schemas/replay-signature-reader.ts
apps/web/tools/piggyvest-staging/schemas/replay-signature-reader.test.ts
apps/web/tools/piggyvest-staging/replay-worker.ts
apps/web/tools/piggyvest-staging/replay-run.ts
apps/web/tools/piggyvest-staging/replay-runtime-pass.ts
apps/web/tools/piggyvest-staging/replay-runtime-pass.test.ts
apps/web/tools/piggyvest-staging/replay-prefunded.ts
apps/web/tools/piggyvest-staging/replay-prefunded.test.ts
apps/web/tools/piggyvest-staging/replay-run-prefunded.test.ts
apps/web/tools/piggyvest-staging/schemas/replay-prefunded.ts
apps/web/tools/piggyvest-staging/schemas/replay-prefunded.test.ts
apps/web/tools/piggyvest-staging/replay-prefunded-contract.md
```

## Deferred validation

New test source covers byte/signature preservation, mismatched provenance, missing
signatures, explicit legacy routing, unresolved enrollment, deferred/rejected/conflict
outcomes, storage exceptions, false lease CAS, decryption refusal, outflow evidence,
other financial routing and actual runner-to-worker injection. All remain unrun;
neither red nor green is claimed. Commands for after explicit release:

```sh
pnpm --dir apps/web exec vitest run tools/piggyvest-staging/replay-prefunded.test.ts tools/piggyvest-staging/schemas/replay-prefunded.test.ts tools/piggyvest-staging/replay-run-prefunded.test.ts tools/piggyvest-staging/replay-runtime-pass.test.ts tools/piggyvest-staging/replay-worker.test.ts tools/piggyvest-staging/replay-financial-worker.test.ts tools/piggyvest-staging/replay-store.test.ts tools/piggyvest-staging/replay-store-fencing.test.ts tools/piggyvest-staging/replay-run.test.ts
pnpm --dir apps/web exec vitest run tools/piggyvest-staging/replay-signature-reader.test.ts tools/piggyvest-staging/schemas/replay-signature-reader.test.ts tools/piggyvest-staging/replay-store-signature.test.ts tools/piggyvest-staging/replay-private-fetch-signature.test.ts tools/piggyvest-staging/replay-private-fetch.test.ts
pnpm --dir apps/web exec vitest run tools/piggyvest-staging/replay-entrypoint.test.ts tools/piggyvest-staging/replay-configuration.test.ts tools/piggyvest-staging/replay-prefunded-loader.test.ts tools/piggyvest-staging/replay-protected-file.test.ts tools/piggyvest-staging/schemas/replay-prefunded-settings.test.ts tools/piggyvest-staging/schemas/replay-runtime-config.test.ts tools/piggyvest-staging/replay-artifact
pnpm --dir apps/web exec biome check tools/piggyvest-staging/replay-prefunded.ts tools/piggyvest-staging/replay-prefunded.test.ts tools/piggyvest-staging/schemas/replay-prefunded.ts tools/piggyvest-staging/schemas/replay-prefunded.test.ts tools/piggyvest-staging/replay-run-prefunded.test.ts tools/piggyvest-staging/replay-runtime-pass.ts tools/piggyvest-staging/replay-runtime-pass.test.ts tools/piggyvest-staging/replay-run.ts tools/piggyvest-staging/replay-worker.ts tools/piggyvest-staging/replay-store.ts
pnpm --dir apps/web exec biome check tools/piggyvest-staging/replay-private-fetch.ts tools/piggyvest-staging/replay-signature-reader.ts tools/piggyvest-staging/replay-signature-reader.test.ts tools/piggyvest-staging/replay-store-signature.test.ts tools/piggyvest-staging/replay-private-fetch-signature.test.ts tools/piggyvest-staging/schemas/replay-signature-reader.ts tools/piggyvest-staging/schemas/replay-signature-reader.test.ts
pnpm --dir apps/web exec tsc --noEmit -p tools/piggyvest-staging/tsconfig.json --pretty false
pnpm --dir apps/web exec tsc --noEmit --pretty false
```
