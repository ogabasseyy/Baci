# Oxygen staging webhook observer

Standalone discovery harness. This receiver records redacted field structure,
header names, and known status values only. It never changes a customer,
application, eligibility decision, or loan. Every delivery is marked unverified;
the correlation header is not authentication. No raw payload or header values
are saved. Output is limited to 100 deliveries per process and 256 KiB per body.

From the repository root:

```sh
pnpm --filter @baci/web exec tsx tools/oxygen-webhook-observer/cli.ts
cloudflared tunnel --url http://127.0.0.1:3430 --no-autoupdate
```

The tunnel must point only to this receiver, never the manual-test form.
Append `/oxygen-staging-hook` to the HTTPS tunnel URL. The URL is temporary and
only works while the receiver, tunnel, and computer remain running.

Register once in a private interactive terminal (replace the example URL):

```sh
NODE_OPTIONS=--conditions=react-server pnpm --filter @baci/web exec tsx tools/oxygen-webhook-observer/register-cli.ts https://example.trycloudflare.com/oxygen-staging-hook
```

The script asks for staging partner reference and secret without echoing or
saving them. It pins the staging API, calls the documented create endpoint once,
uses disposable callback credentials, and reports HTTP status plus a redacted
diagnostic (message/error, field structure, and a UUID request ID if supplied).
Raw bodies, callback credentials, partner keys, and header values are not saved.
It marks registration confirmed only for a matching active registration receipt
with an ID. A bare 2xx, non-JSON body, or a mismatched receipt is unconfirmed.
It never automatically switches from create to update. A timeout is unconfirmed;
do not blindly retry. A conflict requires inspection of the existing configuration.
The explicit update mode is only for an owner-authorized replacement of this
known diagnostic observer's callback; never use it on another integration's
registration. It rotates the disposable observer credentials. Callback credentials
are intentionally not retained: this is an unverified observer, not a production
webhook handler.

Redacted observations are appended with mode 0600 under
`~/.local/state/baci-oxygen/webhook-observer/observations.jsonl`. Synthetic probes
are transport tests only. Registration success is not proof of actual Oxygen
delivery. Complete an authorized staging KYC event or ask Oxygen for a resend
after registration to observe a real event. A previously completed selfie might
not produce another event. Keep KYC status lookup authoritative until delivery
authentication, event correlation, replay/idempotency, and payload contracts are
verified.

Validation:

```sh
pnpm --filter @baci/web exec vitest run tools/oxygen-webhook-observer
pnpm exec biome check apps/web/tools/oxygen-webhook-observer
```
## Reuse staging keys locally

Run `python3 apps/web/tools/oxygen-webhook-observer/staging_keys.py setup`
once from this worktree. Hidden prompts save the partner reference and secret in
macOS Keychain under `baci.oxygen.staging.test-tools`; no environment file is
created. Subsequent `form` and `webhook CALLBACK_URL` commands retrieve that entry
and supply credentials to the staging child process in memory. Use
`webhook-update CALLBACK_URL` only to update a known existing registration when
the temporary tunnel URL changes; it sends one update without automatic retries.
macOS may ask for
Keychain access. `form` restores the existing checkpoint and starts the local
form; `webhook` sends one registration attempt and does not update or retry it.
