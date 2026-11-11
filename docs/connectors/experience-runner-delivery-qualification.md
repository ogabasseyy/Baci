# Runner and delivery qualification package

Status: local disabled release candidate, based on main `f5985ba6aa4dba11abef872a18409518624386e6`.
Benchmarks are parked by owner instruction. No performance, private-apply or publication gate is weakened.

## What this package establishes

The existing local Linux VM has been inventoried and checked using `createPinnedLinuxInstallationVerifier`, then used by the actual `createLinuxRunner` direct OCI transport for a signed synthetic compile. Full inventories cover file bytes, owner/group, modes, directories, symlink targets and unexpected extra files in both root filesystems. The runtime binary and version checks fail closed on drift. Local TLS tests cover output integrity, separated cookie sites, CSP, denied mutations, expiry, revocation and rollback denial. The normal owner/RLS regression covers build, three browser engines at two widths on both trusted parent origins, private preview and revocation without publication.

This is not an approved production-image provenance record. The pin in the evidence directory was explicitly observed on the existing disposable local installation. Do not copy it to a production host or learn new pins automatically during startup. A matching hash is an integrity comparison, not proof of image origin or an immutable host filesystem.

## Installation contract for a later separately authorized host

1. Prepare the reviewed candidate's compiler/browser filesystem images and fixed workers in the existing `/var/tmp/baci-experience-checkpoint-a/{node24,browser}/rootfs` layout. Preserve the reviewed OCI policy: non-root sandbox, read-only root, no-new-privileges, no capabilities, no host credentials/mounts, network disabled, fixed job kinds, time/memory/output budgets and owned-job cleanup. Use an isolated non-production host for the first qualification. Do not provision the production VPS as part of this local package.
2. Establish independently trusted rootfs inventories and runsc pins from the frozen release images. The installation pin binds those measurements to the exact toolchain digest. Protect the pin against writes by the runner, web worker, merchant or generated code. Keep runtime files immutable to untrusted principals. Supply a clean root-owned installation and a privileged *startup preflight* able to read all rootfs files and execute the two fixed `chroot ... node --version` checks. This preflight never executes merchant modules. Do not expose privileged inventory generation or arbitrary chroot/command arguments through HTTP/MCP.
3. Wire `createPinnedLinuxInstallationVerifier(trustedPin)` into `createLinuxRunner.verifyInstallation`. Supply the separately protected runner-signing key and exact matching `toolchainDigest`. A missing/mismatched pin, unsupported platform, writable installation path or changed version must abort startup. Never replace verification with an echo of a configured digest. Use the narrow trusted runner service/helper permissions required by the existing direct OCI adapter; do not grant the web application or authored frame those permissions.
4. Put the signed `/v1/execute` endpoint behind authenticated private HTTPS ingress. No direct untrusted source execution, arbitrary executable, caller-selected image, environment or host network is accepted. Retain request expiry, replay and lane restrictions. Public-render jobs may only prerender and must not consume both owner execution slots. Keys stay in the trusted control plane, never in the authored artifact or browser.
5. Mount the integration's output-only `deliver(Request)` on a distinct HTTPS cookie site. Resolve the external execution authority from the trusted ingress configuration; never derive it from arbitrary forwarded-host headers. Keep private resources no-store/noindex, without cookies, credentials or commerce effects. Verify CSP/frame ancestors and no cookie-domain overlap with builder and merchant sites. Do not use the synthetic test certificate or SPKI exemption on deployed ingress.

Example trusted startup composition (not an activation script):

```ts
const verifyInstallation = createPinnedLinuxInstallationVerifier(trustedReleasePin);
const runner = await createLinuxRunner({ key: runnerKey, toolchainDigest, verifyInstallation });
// Adapt only the fixed signed route to the approved HTTPS ingress.
```

`startRunnerService` composes this preflight with a same-user, mode-0600 Unix
socket for the fixed `/v1/execute` route. Its HTTPS ingress and production
configuration are still operator responsibilities: the socket does not provide
TLS, provision a trusted pin or authorize access on its own. The signed runner
handler remains responsible for request limits, replay protection and lanes.

**Production privilege blocker:** on the Contabo host, an unprivileged account
cannot execute the verifier's `chroot` version checks. The current direct OCI
transport also invokes `sudo python3 -c` with a spec on standard input. Its
in-process command allowlist prevents accidental calls through that adapter but
does not constrain what a compromised service account could invoke through a
broad sudo rule, nor independently validate a supplied OCI spec. Do not grant
the service account general Python or runsc sudo access, and do not start the
socket with those privileges. Production needs a separately reviewed,
root-owned fixed helper that enforces the complete OCI policy independently,
plus a narrowly authorized privileged preflight and tests of the actual OS
permission boundary. The existing runner remains qualification-only until
that boundary is implemented and verified.

`privileged-helper.py` now reconstructs the policy and limits its command path
to prepare/run/delete with validated job IDs and root-owned parent directories.
Its operations have only been tested with local synthetic fixtures and mocked
`runsc`. It has no qualified deployment packaging, sudo policy, privileged
preflight or real Linux OS-boundary test yet. Do not install it or grant it
privileges in its current state.

## Baci boot and database boundaries

Use `createProductionExperienceIntegration` with the established connector authenticator, normal user-client resolver, normal anonymous public client, trusted canonical merchant-domain resolver, owner bootstrap reader, scoped evidence verifier/recorder, retained artifact directory and normal owner-intent/approval callbacks. Do not supply a service-role client or accept merchant identity/approval/renderer bytes from MCP arguments.

The evidence-recording role must have only the existing scoped verifier operations; separately qualify provisioning and RLS ownership/staff/anonymous behavior against the real schema. Local fixture SQL is not a hosted migration installer. Migrations remain append-only and require a separately authorized deployment step.

Explicitly register `configureProductionExperienceBoot(integration.composition)` in every MCP/web worker that requires these ports, then await normal startup registration. No environment discovery or activation is automatic. Retain all existing feature flags, account-link and private-apply/performance gates. Merely constructing the integration must perform no tenant reads or runner calls.

The initial design is one process with an owned persistent volume. Companion output has integrity checks and bounded retention. Private tickets are process-local and intentionally fail closed after a restart. Qualify those restart semantics; do not put independent workers behind a load balancer and assume their in-memory tickets/replay state are shared. HA/distributed replay storage is a separate rollout prerequisite.

## Required host acceptance evidence

- Frozen candidate tree/archive hashes and independently approved image/toolchain pins.
- Verified installed filesystem digests, versions, root ownership, worker policy and isolation, plus a signed offline compile/render/browser job. A host or toolchain change invalidates the old installation receipt.
- Normal owner, staff-denial, anonymous/public, grant-revocation and cross-merchant checks through the actual MCP/backend configuration.
- Actual HTTPS hostname/TLS/cookie/frame isolation, canonical custom-domain routing, restart/expiry/revocation and delivery resource integrity.
- Verify that each MCP gateway and proxy can carry the 300-second finalize call. After an interrupted response, read the existing job with `get_experience_operation`. If it is retryable, use the same job ID and idempotency key.
- Rollback proof: call the boot uninstaller, then `integration.dispose()`. New MCP/auth/runner work is rejected, output is denied, and tenant pipeline registrations are removed. Existing merchant data/history must remain. Do not reverse old migrations or publish a replacement head as rollback.
- Required exact-commit CI and source-bound review. Current scoped local checks are not candidate-wide CI.

Benchmarks are deliberately deferred. Existing source-bound performance qualification remains enforced; there is no bypass to enable private apply or publishing. Field CWV and INP are not claimed. Production host acceptance, deployment and merchant activation are pending separate authorization; this package publishes nothing and creates no orders or payments.

## Local reproduction

Run one command at a time in `apps/web` using the task worktree:

```sh
pnpm --config.verify-deps-before-run=false exec vitest run --config vitest.experience-runner.config.ts tools/experience-runner/installation-inventory.test.ts tools/experience-runner/installation-verifier.test.ts tools/experience-runner/preview-delivery-tls.test.ts --maxWorkers=1
pnpm --config.verify-deps-before-run=false exec vitest run --config vitest.experience-runner.config.ts tests/experience-browser/production-linux-installation.test.ts --maxWorkers=1
pnpm --config.verify-deps-before-run=false exec vitest run --config vitest.experience-authoring.config.ts tests/experience-authoring/production-runner.test.ts --maxWorkers=1
```

The native installation test explicitly observes a *local* pin, then independently re-reads the installation before invoking the native runner. It writes only its owned trusted driver under the existing local runner directory. It needs the already-installed local VM, images, runsc, Node and Playwright; it performs no provisioning, downloads or external AI calls. Its whole-filesystem hash work is installation integrity checking, not a CWV benchmark. The driver runs as the trusted local operator to read protected rootfs files; merchant source remains inside gVisor.
