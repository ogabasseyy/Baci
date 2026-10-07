# Activation checkpoint — 25 September 2026

## Current verified state

- Owner route recovery completed at `2026-09-25T16:03:12Z`. Installed Nginx
  SHA-256: `ec79a335e520990030ba8c65df7cbfcce68667704fc22adbf8dc53eb830faeee`.
- Independent checks through `https://staging.ogabassey.com`: initialize,
  confirm, and manual contribution POST each return 401; initialize GET returns
  405; wallet, goals, drafts, and notifications GET remain 401; PiggyVest
  receiver GET remains 200. These are route/auth-negative checks, not payment
  settlement proof.
- Payment service, its deadline timer, gateway, funding, and drafts services are
  active. Loaded payment timer still expires `2026-09-29T15:59:10Z`.
- Metro was restarted in this worktree with only the test-payment capability
  added to the existing staging environment. Launcher PID 39141; Metro PID
  39166; port 8082. Recheck ownership before any later restart. The served iOS
  bundle's Expo virtual environment contains the enabled capability, hosted
  staging mode, and both exact staging origins. Device storage was not changed.
- The phone can now attempt the test-card flow. Authenticated initialization,
  actual Paystack test checkout, one wallet credit, confirmation retry without
  another credit, and the subsequent savings contribution still need live
  customer verification. Recurring card debits are not part of this slice.

## Completed

- Restricted Paystack test service built from this worktree; 59 Vitest tests,
  dedicated typecheck, and scoped Biome pass.
- Mobile payment gate/flow: 69 focused Jest tests pass. Shared keyboard/modal
  regressions: 9 tests pass. Platform drift check passes.
- Owner packaging/install/gateway tests: 40 pass. SQL rehearsal on the actual
  isolated database used the canonical wallet credit function and rolled back
  every change; first credit/retry behavior and unchanged final balances passed.
- Dedicated staging Vercel proxy deployed prebuilt and aliased successfully:
  `dpl_2DhBNwbxmjzMaAtH7vjaMNYj28TP`. Project:
  `prj_vgV7DiXC52wOhbClB2uzjGAg9IZd`. Production commerce was not deployed.
- Public checks after deploy: PiggyVest receiver GET 200; wallet, goals, drafts,
  notifications GET 401; GET on the three new POST-only routes returns 405.
  These checks do not prove authenticated payment settlement.

## Earlier route failure (recovered)

The owner ran the original installer successfully. Independent checks found
`baci-staging-test-payments.service` active on `127.0.0.1:4897`, its deadline
timer active, and unauthenticated initialize returning 401 directly. Gateway,
drafts, and funding services remained active. The credential was not printed.

However, all three new POST routes subsequently returned 404 through both
public origins and VPS loopback TLS. The Nginx target has an old modification
time and a new change time at `2026-09-25T15:33:23Z`, after the installer's reload.
This is consistent with a restored configuration, but the responsible writer
has **not** been established. The legacy non-persistent activation code alone
is not evidence that it ran. Existing customer routes still return 401 and
the PiggyVest receiver still returns 200 on its GET probe.

Do **not** rerun the service installer or re-enter the credential. The route-only
recovery validated the saved predecessor hash and preserved services, database,
and lease. Before this recovery, Metro PID 16898 had the payment flag off; it
has now been replaced by the verified enabled Metro process recorded above.

Completed route-only command (historical record, no rerun needed):

```sh
/bin/sh /private/tmp/baci-test-payments-nginx-recovery-20260925-reviewed.sh
```

Uploaded to `/home/bassey/baci-test-payments-nginx-recovery-20260925`, with
remote checksums and mode 0600 verified. Archive SHA-256:
`170bf6a1ee153b2f6f416de38724f922e3575fc7264015607db01857d2bdbd21`.
Bootstrap SHA-256:
`e9d701e10363cbeab1eac20024430f8f50f8ca5da82e8efb1d48bff8ee08efac`.
The inner manifest remains the original `be149891...443f2b`; the recovery
entrypoint is sealed by the outer archive manifest, not added to the service
manifest's exact file set. A packaging round-trip regression reproduces and
prevents the strict-manifest mismatch caught during review.

Recovery checks the installed server/unit hashes, loaded timer deadline, direct
401 responses, all three new POST 401 / GET 405 responses, five prior route
expectations, and 15 seconds of configuration/route stability. It serializes
recovery invocations with a root-owned advisory lock and checks the exact live
bytes/fingerprint immediately before replacement. It does not claim atomic
compare-and-swap against a non-cooperating root writer. On observed foreign
configuration drift it refuses rather than overwriting it during rollback.
No credentials, database rows, application units, gateway bindings, or lease
dates are changed by this entrypoint. The owner ran it successfully; independent
public checks subsequently passed as recorded above.

## Original installation record

Completed original installation command (do not rerun):

```sh
/bin/sh /private/tmp/baci-test-payments-20260925-reviewed.sh
```

It prompts privately for VPS sudo and the Paystack **test** secret if not already
installed in this service's credential path. The generated database password
never enters arguments or logs. No service-role key is used.

Uploaded, verified remote staging directory:
`/home/bassey/baci-test-payments-20260925`.

| Artifact | SHA-256 |
| --- | --- |
| owner-bundle.tar.gz | af39e877621eda98c5e0a69d8510d44a133aa61cc6962ee8cbf80009f1f229e1 |
| bootstrap.py | a67fbb56c90c2596373a2ca6380ccc271e4483e8b623214052ab6916d2ebb764 |
| bundle.json | be14989127865c059e112fc5e0b198febe727df002815c9c6d8319a43d443f2b |
| server.cjs | cba545d7312ad3c5d9c364798be2f99fea2a8cc22a9fe2560f0611d9ac9392d2 |

The chosen loopback port is **4897**. Port 4797 belongs to another Next server;
do not stop it. `/etc/baci` is root-only 0700, so runtime configuration and CA are
read through systemd credentials, not by traversing that directory.

## Remaining live customer checks

1. Verify authenticated initialization with the synthetic customer. Complete a
   Paystack test checkout, confirm the matching payment, prove one wallet credit
   and zero additional credit on confirmation retry, then contribute to savings.
2. Verify the phone displays the updated contribution/payment flow, then
   relaunch and confirm login and balance persistence. Never log session tokens.
3. Report actual transaction outcomes separately from the route and served
   bundle checks already completed. Production commerce remains unchanged.

Root lint/typecheck were run but still encounter unrelated existing failures:
mobile date-format test readonly tuples and savings submission test input fields,
plus existing formatting issues. CodeRabbit skipped new untracked files; it did
not provide a clean review. Luna/Terra independent review and focused tests were
used; do not describe the whole repository as green.

Keep receipts/backups on any installer refusal. Post-database or post-gateway
failures deliberately require inspection rather than destructive reinstall.
