# Contabo runner qualification plan, 15 November 2026

Root SSH inspection of `vmi3734186` confirmed that both GitHub CI runner
services were active. The compiler and browser rootfs directories exist under
`/var/tmp/baci-experience-checkpoint-a` and are root-owned mode 0755. Installed
`/usr/local/bin/runsc` matched the previously measured digest. The fixed
helper, protected Node executable, preflight bundle, installation pin, runner
state directory and `browser/rootfs/opt/experience/public-observation-worker.mjs`
were absent. Caddy was absent and TCP 443 had no listener. The check changed
no host state.

## Candidate bytes and receipts

Node 24 assembled the working tree at base
`782b9f8325881c20ca2bdc5e7cd42b58b8f6bc71` into the unqualified local directory
`/tmp/baci-builder-candidate-D0jYUX`. To regenerate from a frozen checkout, run
from `apps/web` with its locked dependencies installed:

```sh
node --input-type=module -e "import {assembleBuilderCandidate} from './tools/builder-production/operator-assembly.ts'; console.log(await assembleBuilderCandidate('/tmp'))"
```

Use native Node, since the tsx invocation tried to transform the widget
module's top-level await to CommonJS. Keep the emitted manifest, exact commit
and reviewer receipts together. The directory above is a local experiment.

| Artifact | SHA-256 |
| --- | --- |
| `helper.py` | `2a4be71a14696a62e3ee47d2202ca942cacf86e9fd76a69a7c3d488b640235f6` |
| `preflight.mjs` | `766df4f80a7c19b57a270499867c174dfe1bd31372d05101d20735023f5595a5` |
| `public-observation-worker.mjs` | `84b1a853e570aa8d1e7005f767347e537e91842ca9adc00fdc3dc8178312e808` |
| `runner.mjs` | `2330dacc132823c34298f54f690a66e18c39e977e1c5c7d56ec800fb3b6180c3` |

The first three hashes match the temporary qualification evidence. The current
runner bundle differs from the earlier Contabo startup bundle (`d2ed025…`).
It now waits 91 seconds before opening either listener so signed requests from
a prior process expire. Requalify this exact entry point. The helper adapter
uses a 900-second preflight deadline. The measured 539-second earlier preflight
plus the replay hold is about 630 seconds before the listeners may appear.

The independently reconstructed compiler and observer-inclusive browser
inventories matched Contabo during the temporary qualification. The local
candidate pin `/tmp/baci-builder-observer-pin-unqualified.json` records these
values. Any release pin must be approved against the frozen candidate and
repeat startup verification after installation.

| Pin item | Expected SHA-256 |
| --- | --- |
| Compiler inventory | `e617b383f90471f3bdb96c55bbb11d3f6e4874821eee2f1805fb0d50ec07ac75` |
| Browser inventory with observer | `4f0740a188ae93c9009c71a57a67f22712baf4f1d5f7aeefe3dbbf098ea6fdc5` |
| `runsc` | `5b4016fa43a9d35835253925cb6d05d3e42fdb9eb8bcd426c8b25444090e93e6` |
| gVisor helper directory inventory | `9aed8725b3d5f970c065fb72ef4143187d0c1bf5683b561fb0a193e263f34c1f` |
| Observer-inclusive toolchain profile | `2fba2335351e62e55017ba6ba40e6317968816486cca7dad5d67469717806710` |

The compiler and browser versions are Node `v24.21.0` and `v24.20.0`, and
`runsc` is `release-20261019.0`. Preserve the exact observer filename.
An empty mount placeholder changed the previous inventory.

## Next loopback-only qualification on Contabo

1. Freeze and record the candidate manifest, approved v2 pin, service-Node
   binary digest and distinct test ports. Record the prior state of every
   target, both CI units and any existing runner jobs. Stage root-owned files
   out of the service account's reach. Abort on an unexpected existing target
   or hash drift. Finish the signed compile and observer trials before
   enabling unattended startup, public TLS, DNS or firewall changes.
2. Atomically install the reviewed `helper.py` as
   `/usr/local/libexec/baci-experience-helper` (root:root 0755),
   the verified ordinary Linux Node executable as
   `/usr/local/libexec/baci-experience-node` (root:root 0755, regular file),
   and `preflight.mjs` as
   `/usr/local/libexec/baci-experience-preflight.mjs` (root:root 0644, regular
   file). Install the reviewed v2 JSON as
   `/etc/baci-experience/installation-pin.json` (root:root 0600) in a protected
   root-owned directory. Install the observer root:root 0644 at the missing
   path above. Retain root control of the complete rootfs trees,
   `runsc`, gVisor helpers, and the runtime's `jobs` and `state` directories.
3. Create a dedicated non-login runner account. Use a `visudo`-validated
   root:root 0440 drop-in giving only that account passwordless access to
   the exact fixed helper. Its argument parser constrains preflight and
   prepare/run/delete to the fixed job kinds and owned UUID bundle shape.
   Deny arbitrary Python, Node, chroot and runsc. Verify effective permissions
   using `sudo -l -U <runner-user>` and negative tests from the account.
   Confirm the account cannot modify the helper, Node, preflight, pin or rootfs.
4. Install the exact `runner.mjs` in a root-owned release directory, separate
   from writable account state. Make `/var/lib/baci-experience-runner` and its
   `run` subdirectory service-owned 0700. Provision a service-owned 0600
   `runner.json` containing a fresh synthetic base64url 32-byte signing key,
   the exact toolchain digest and reserved `loopbackPort`. Pass the same test
   key to the trusted synthetic controller without printing it. Begin with a
   manually controlled process and account for the replay hold plus the
   preflight deadline in the supervisor. Prove absence of a listener before
   either check completes, then prove the Unix socket is mode 0600 and TCP
   binds only to `127.0.0.1`. Repeat with a deliberately wrong expected digest
   and confirm startup fails closed.
5. Send a signed synthetic compile through the exact entry point, recording the
   expected heading, verified response and build digest. Reject unsigned,
   expired and replayed requests. Restart and verify an old signed request
   cannot be replayed. Run the separate co-located verifier through the installed
   helper with a synthetic generated storefront, fixed Chromium observer and
   synthetic cart/review responses. Record outcome, process exit, timing,
   network-disabled policy and cleanup. The earlier 39.2- and 41.9-second
   observer passes and the initial timeout warrant engine and relay timing
   checks while CI is active. Avoid production mutations and paid providers.
6. Stop listeners and drain owned requests. Confirm the socket and loopback
   port are closed. Delete only task-owned job UUIDs through the fixed helper
   before removing the sudo drop-in. Restore recorded prior files or remove
   only added files, including the staged observer after verifying its hash.
   Remove the rehearsed account and temporary test credentials only once
   their processes are gone. Verify that both CI services remain active and
   report any orphaned job or failed cleanup. Keep the baseline runtime and
   existing merchant data intact. Repeat this rollback with the service
   supervisor before approving persistence.

## What remains after local code checks

- The older broad-sudo/direct OCI concern and missing fixture-worker allowlist
  were code concerns. The candidate has a fixed privileged helper and rejects
  the fixture-only job kinds. The observer assembly/runtime bundle mismatch
  was also corrected by sharing the bundler. The current tests passed
  29 checks across helper execution, helper policy, preflight, startup and
  observer execution, plus one operator assembly check. The assembly test
  compares output bytes and smoke-tests entry points. These are local tests.
- Missing installed files, protected pin approval, exact-process startup and
  rollback, sustained observer timings, real verifier credentials and
  isolated delivery ingress are operator acceptance gaps. The 12 November
  installation runbook's statements that the helper only had mocked evidence
  predate the temporary host trials. Use the concrete receipts in
  [the Contabo qualification record](builder-contabo-qualification-20261111.md).
- The public MCP metadata and OAuth issuer require the exact reviewed Vercel
  bridge and separately deployed auth service. Owner mTLS and the distinct
  execution cookie site require separate ingress verification, including
  header and ticket logging checks. The runner command stays loopback-only.
  The [ingress candidate](../../../apps/web/tools/builder-production/INGRESS-CANDIDATE.md)
  records the current public routing. A verified domain does not establish a
  connected ChatGPT app.
- An authenticated synthetic reviewer journey must still cover the real
  connector protocol, owner isolation, link and revoke, generated design
  build, private preview and independent verification, and simulated
  cart/checkout review. Use only synthetic data and stop before order,
  payment, paid AI, merchant publication or final submission. The full
  release also requires exact-head CI and both source-bound reviews.

## Exact runner loopback trial result, 15 November 2026

The Contabo trial passed with the `runner.mjs`, helper, preflight and
observer hashes listed above. A dedicated temporary account started the
runner using the protected v2 candidate pin and a fresh synthetic signing
key. Both listeners stayed closed during the replay hold and preflight.
Readiness was observed at 567 seconds. The socket had mode 0600, and the
TCP listener bound only to IPv4 loopback. The account could invoke the
fixed helper through sudo, while direct privileged Python, direct
privileged runsc and an unsupported helper job kind were rejected.

A signed synthetic compile returned the expected heading and build digest
`0a72d6c24a5c6a52a1ab327b64a56b5be27f1b7f8255f7a372a6042f392293f8`
through network-disabled gVisor. The client verified the signed reply and
required HTTP 401 for an unsigned request and HTTP 409 for an exact replay
before reporting success. The wrapper exited zero. Cleanup removed the
listener, helper, preflight, pin, observer, service files, account and sudo
rule. A separate SSH inspection confirmed those removals, identical job
directory entries before and after, no listener on the test port or 443,
and both existing CI runners active.

The root-only receipt is
`/var/tmp/baci-runner-qualification-20261115.5utR9qEv/qualification.log`,
SHA-256 `b7ac78fec315030d69c0f5576cb87382590dc9f85961f8b6e0f0993b7d4f151c`.
The observer bytes participated in the protected browser inventory and had
been exercised separately in the prior helper trial. This exact runner
trial exercised compilation. Restart replay, wrong-pin startup, current
verifier composition, real OAuth and HTTPS ingress still need their own
acceptance receipts. No permanent service, DNS, firewall, paid AI, order,
payment, publication or submission was involved.

## Root-only artifact staging, 15 November 2026

The operator assembly built from `028da10658232f3812baa65fec4001a3f99ba900`
and its disabled staging script were transferred to
`/root/baci-builder-candidates/028da10658` on Contabo. All 16 checksums
matched. The directory is root-owned mode 0700 and files are mode 0600.
The candidate manifest SHA-256 is
`371ed1b915beeddd0c8fd95bd697e77949277cb0e42727e6d1f16aff02f324b9`;
the transfer checksum manifest SHA-256 is
`999788c2929a7829435c1fc2d7ea97ee8f7c770db677a1bd2bdf4eba51ca9ad7`.
No fixed installation path, sudo policy, service, firewall or DNS changed.
This directory records the earlier source commit. The subsequent PR head
`bdcd99f14444e770e4cffb5175684c0e168d5f27` needs its own assembly comparison
before rollout.

## Exact runner crash and restart trial, 15 November 2026

The updated runner SHA-256
`efa5b759faa459ee016cce9f4bcfe03fa7d9d0506ae7bc389474d80e8c0d1ef2`
passed a two-generation test on Contabo. The preflight, privileged helper and
browser observer still matched the corresponding hashes above. The first
generation opened its private socket and loopback listener 541 seconds after
invocation, after checking the complete v2 pin. It returned the expected
signed synthetic compile with the same build digest as the earlier trial.
A targeted SIGKILL left the socket on disk and closed the loopback listener.
The second generation of the same bundle reopened both listeners after the
replay hold and full protected preflight. It reached readiness in 319 seconds
with a warm filesystem cache and returned the same signed compile digest.
Both checks rejected unsigned requests and exact replays within each
generation. This trial covers socket recovery and does not measure replay
across generations.

Focused local checks confirmed that the recovery helper preserves a symlink,
its target, a regular file and a live socket at the configured path. Recovery
requires one startup owner for that path. The trial held an exclusive kernel
lock, and the service operator must reserve the runtime directory to one
systemd unit, with no overlapping standalone, full-stack or qualification
startup. The inode recheck followed by unlink is not an atomic cross-process
operation.

The root-only receipt
`/var/tmp/baci-runner-crash-20261115.Mh1ik8QG/qualification.log` has SHA-256
`93b7b003a01500b92b589fdb315edce4ac6a29262dbd2560c138155af6dd3a7f`.
The wrapper exited zero. A separate SSH check confirmed both CI units active,
the task listener and fixed fixture paths removed, the temporary account and
sudo rule removed, and identical job-directory entries before and after.
No permanent service, DNS, firewall, paid AI, order, payment, publication
or submission was involved.

The full operator assembly for commit
`e975c5c86fcd4a14db38a07e44dca14605176af8` was staged with root-only permissions
at `/root/baci-builder-candidates/e975c5c86f`. All 13 transfer checksums matched.
The assembly manifest SHA-256 is
`d2ca5edcac7a714f54bdc94bc8448047a41fbce053052280faed6fa8e60d0d80`
and the transfer manifest SHA-256 is
`db9da656e1b153188cb24417a9e91a1671b5143ae243c83cb38d86846d1b5fdc`.
The staged runner, helper, preflight and observer are byte-for-byte equivalent
to the crash trial artifacts. The full operator package remains an unqualified
assembly. The transfer installed no fixed-path files and started no services.
