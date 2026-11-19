# Authenticated staging callback inbox

Standalone local staging receiver. It does not use Baci production/Supabase data,
change orders, activate loans, or perform payouts. It uses the shared callback
parser and authentication contract. Only documented, authenticated payloads are
accepted. Unsupported payloads return 400; they are not silently acknowledged.

## Storage and secrets

- Inbox: `~/.local/state/baci-oxygen/staging-webhook/inbox.sqlite`, mode 0600 in a
  private directory. SQLite commits with `synchronous=FULL` before HTTP 200.
- Callback credentials: macOS Keychain service `baci.oxygen.staging.callback`,
  account `staging-partner`. Credentials are bound to the saved staging partner.
- Partner API credentials remain in their existing Keychain entry. No `.env`
  changes, raw header logs or callback credentials in registration evidence.
- Settlement IDs and transaction references are deduplicated per staging partner.
  A changed payload under the same key fails rather than overwriting evidence.
  Address notifications have no provider event ID and are recorded individually.
- Normalised callback payloads can contain personal identifiers. Keep the inbox
  private; use the count-only summary for routine output. Do not commit/export
  the database. These records do not themselves prove bank receipt.

## Run from the worktree root

```sh
python3 apps/web/tools/oxygen-staging-webhook/launch.py setup
python3 apps/web/tools/oxygen-staging-webhook/launch.py serve
```

In a separate terminal:

```sh
cloudflared tunnel --url http://127.0.0.1:3431 --no-autoupdate
```

After public `/health` returns staging readiness, update the **known staging**
registration to `https://<assigned>.trycloudflare.com/oxygen-staging-hook`:

```sh
python3 apps/web/tools/oxygen-staging-webhook/launch.py register https://ASSIGNED.trycloudflare.com/oxygen-staging-hook
```

This sends one update, with persisted callback credentials and top-level
`active: true`. It writes a private intent before mutation and a redacted result
afterwards. HTTP success alone is insufficient: the matching active registration
receipt must be confirmed. On timeout/unconfirmed result, reconcile before any
retry. Do not use this command to replace another integration's registration.

Read receipt counts without exposing customer payloads:

```sh
python3 apps/web/tools/oxygen-staging-webhook/launch.py summary
```

## Availability and current registration

On 20 October 2026, Oxygen returned HTTP 200 with a matching active registration
receipt for the new authenticated receiver. This replaced the old diagnostic
observer's staging callback. The exact current URL and registration intent/result
are in the private staging-webhook directory, not a permanent configuration.

A quick tunnel is temporary and has no uptime guarantee. This Mac must stay awake
with both processes running. Receiver restarts retain credentials and stored
events; a tunnel restart can change its URL and needs an explicit registration
update. A named persistent host is needed before unattended or production use.
There is no scheduled monitor or automatic registration rotation.

## Verification

Relevant tests cover restart durability, private file permissions, scoped
idempotency, conflict rejection and concurrent HTTP deliveries, plus the shared
parser/authentication cases. Public health and unauthenticated 401 were checked.
Synthetic fixtures use temporary test databases; they do not pollute the actual
callback inbox. Actual Oxygen delivery must still be observed or replayed.

```sh
NODE_OPTIONS=--conditions=react-server pnpm --filter @baci/web exec vitest run tools/oxygen-staging-webhook tools/oxygen-webhook-observer src/lib/payments/oxygen
```

Node 24's built-in SQLite currently emits its experimental-feature warning. No
SQLite package or repository dependency was added.

## Repeat the isolated callback simulation

```sh
NODE_OPTIONS=--conditions=react-server pnpm --filter @baci/web exec tsx tools/oxygen-staging-webhook/simulate-cli.ts
```

This uses a new private directory under `staging-webhook/simulations/` and an
ephemeral loopback HTTP server with disposable credentials. It never contacts
Oxygen, reads live callback credentials, uses the registered public endpoint or
writes to the live inbox. It exercises all four documented synthetic samples,
three duplicate deliveries, invalid authentication, invalid shape, a conflicting
replay and database reopen durability. The saved `simulation-report.json` is
explicitly marked simulated. An existing evidence directory is rejected.

The expected consumer work is payment-setup lookup for transaction callbacks,
KYC lookup for address callbacks and recording submitted settlement events.
These notifications do not alone authorize activation, fulfilment or a
bank-receipt claim. Production checkout/queue consumers are not implemented by
the simulation runner.
