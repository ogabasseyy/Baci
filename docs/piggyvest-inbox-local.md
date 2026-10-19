# Local staging inbox foundation

This is offline implementation, not activation. No public route, deployment,
credentials, scheduled worker, provider transaction or customer balance is enabled.

## Processing path

1. `acceptPiggyvestStagingRequest` validates explicit server-owned staging
   configuration, limits request reads to 64 KiB and five seconds, and preserves
   received bytes. Unsupported encoding or failed reads are rejected internally.
2. `acceptPiggyvestStagingWebhook` snapshots bytes, checks the SHA512 signature
   before decoding JSON, and validates only the documented common envelope.
   The integration identity comes from configuration, never the body.
3. `createPiggyvestPostgresInbox` binds one integration identity and uses a fixed,
   parameterized SQL statement. The injected executor must resolve only after
   commit, use a separately provisioned restricted connection, enforce a bounded
   database statement timeout, and never log parameters or database errors.
   No connection or credentials are constructed by this module.
4. The private database inbox atomically stores bytes and their fingerprint with
   a unique integration/event identity. An identical repeat is a duplicate;
   different bytes for the same identity are a conflict and never overwrite it.
5. `quarantinePiggyvestInboxBatch` claims a bounded batch and marks every event
   unsupported. It selects only IDs/tokens, never payloads. It cannot mark money
   processed. Its result reports aggregate counts, not payloads or credentials.

Storage uncertainty is not success. A lost response after commit can be retried
with the original event identity; persisted uniqueness prevents another insert.
Worker uncertainty is recovered through expiring leases rather than immediate
unbounded retries. A stale claim token cannot complete another worker's lease.
An empty claim result is not proof that all work is drained.

## Isolation and permissions

- Private `piggyvest_staging` schema, default-deny RLS and revoked public,
  anonymous, authenticated and service-role privileges. No deployed caller grants.
- Integration registry entries default disabled and bind a unique expected
  provider account identity. Only trusted future provisioning can create them.
- Intake needs only `enqueue_inbox`; quarantine worker needs only `claim_inbox`
  and `finish_inbox`. Do not give either a generic service-role client.
- The registry is not a customer/goal mapping. A future accounting worker must
  independently resolve provider wallet/customer ownership before any effect.
- The local wallet-mapping adapter binds the expected merchant as well as the
  integration, and looks up both provider wallet and customer IDs. A missing or
  unavailable lookup never authorizes an accounting effect or event deletion;
  preserve the event for retry/reconciliation or restricted quarantine review.
- Test harness roles and registry seeds exist only in its disposable local
  database. Running the harness does not provision staging or change secrets.

## Verification and activation gates

Run local SQL behavior checks with:

```sh
bash tools/test/run-piggyvest-inbox-sql-local.sh
bash tools/test/run-piggyvest-wallet-mapping-sql-local.sh
```

The handler's approval flags have no defaults and are not proof of approval.
No real configuration is populated. Before activating them:

- Verify a provider-signed financial vector and its exact serialization. The
  [signature example](https://www.piggyvestbusiness.com/docs/webhooks/signature)
  reserializes parsed JSON; current offline verification uses exact received
  bytes and must not be assumed compatible with every provider delivery.
- Agree HTTP acknowledgement and durable-outage/redelivery handling. Internal
  outcomes deliberately do not invent HTTP statuses or bypass registration logic.
- Confirm provider account identity and provision isolated storage/roles through
  owner approval. Verify backups, encryption, retention and restricted inspection.
  Raw bytes may contain financial/personal data; never send them to logs.
- Define approved raw-body retention and retain deduplication evidence when bodies
  are eventually purged. No automatic deletion or quarantine replay is enabled.
- Provision verified customer/wallet mappings at READ COMMITTED. Mapping ownership
  is immutable and customer identity is one-to-one per integration, while multiple
  wallets/plans for that same customer are allowed. The SQL guard serializes these
  inserts and rejects stale-snapshot isolation levels; do not bypass the guard.
- Supply financial field/amount contracts and implement wallet/customer/goal
  mappings, reconciliation and transactional ledger effects before processing
  anything financially. Every current event is quarantined, including known names.
- Package and test the actual staging artifact: the old registration-only builder
  does not automatically include these libraries or a database driver.

The [common envelope](https://www.piggyvestbusiness.com/docs/webhooks/payload)
is enough to build authenticated storage, but not to infer deposit, settlement,
interest or refund semantics. No timestamp replay window is claimed: the public
contract does not establish a signed timestamp; replay protection here is durable
event identity plus byte consistency.
