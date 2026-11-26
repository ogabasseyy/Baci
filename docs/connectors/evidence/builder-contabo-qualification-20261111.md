# Builder Contabo qualification, 11 November 2026

The Contabo host is x86-64. The pinned gVisor release `release-20261019.0`
was installed from its vendor archive after checking the vendor SHA-512 file.
An isolated direct-OCI smoke process ran as UID 65534 with a read-only root and
network disabled. It could not write to its root or ping an external address.
Both existing CI runner services were active afterward. This is a basic host
smoke test, not a full runner qualification or an adversarial security audit.

The Playwright `v1.63.0-noble` OCI image index fetched from Microsoft Container
Registry has SHA-256
`eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27`.
Its ARM64 manifest is the earlier local proof's
`a0f4498920a5dbac63196d9140ed738ef00470f27e2e74029abd8850b7bd5717`;
its AMD64 sibling is
`bc6ab0d6d44ff4826e4cb8c1e6d801e185bfc42bb0753f8e2a30efc70db054c7`.
The raw index and AMD64 manifest bytes were independently hashed and matched
their advertised digests. These are source-image observations, not an
approved production rootfs inventory or a release attestation.

At the time of the initial smoke test, the compiler and browser filesystems,
fixed workers, independent installation pin, runner service, private HTTPS
transport, production boot and authenticated end-to-end test were still
required. No merchant code was run during that smoke test.

The v2 installation pin also binds the full `gvisor-bin` helper directory. A v1
receipt does not qualify these helpers and must not be accepted for this host.

An offline synthetic signed compile subsequently passed through the native
Linux runner with a v2 observed installation pin, gVisor networking disabled,
Node 24.21.0 for compilation, Node 24.20.0 for browser work, and no orders or
publication. The observed pin was generated on the same host and is qualification
evidence only: it is not independent release provenance or permission to activate
the runner for merchants.

A second offline synthetic run reverified the v2 installation and exercised the
signed runner's Chromium capture at widths 390 and 1440. Both returned the
expected semantic heading and PNG evidence with sandbox networking disabled;
reported job times were 31,790 ms and 32,156 ms. No orders or storefront
publication occurred. This is an offline host qualification, not live OAuth,
checkout, field performance, or independent production-image provenance.

The bundled synthetic auth-service and listener tests also passed on Contabo
as an unprivileged user with Node 24.21.0. These tests cover service lifecycle,
private socket permissions, proxy-header sanitization and issuer discovery;
they do not start a production broker or connect it to production credentials.
A separate local PostgreSQL-backed authorization-code test confirmed the real
provider returns the issuer and state on a successful callback; the upstream
identity provider in that test was simulated.

The public `mcp.usebaci.com` discovery endpoint still returned the Supabase
issuer when checked, rather than the dedicated builder issuer. Production
routing and the actual OpenAI authorization flow therefore remain unqualified;
do not treat the domain verification as evidence of a working connection.

The fixed-policy helper at SHA-256
`1b59ca7125964391e454aff4713db3dcf13cb7db66c589f6944f899995bf7d5b`
was run as root on Contabo without installing it or changing sudo policy. It
prepared, executed and removed one synthetic offline gVisor compile. The output
contained the expected synthetic heading and had build digest
`1dbf6030be64ac229f42973c259292aad0a3f160cd4461c1b5a7ba765de2b9bf`;
both execution and cleanup exited successfully. Direct invocation as the
unprivileged `nobody` user failed. This does not test the service's sudo policy,
privileged installation preflight, independent release provenance or live flow.

A temporary unprivileged system account was then given a `visudo`-validated,
passwordless rule for only the root-owned helper path under the qualification
directory. Through that rule it prepared, ran and cleaned up the same synthetic
compile successfully; direct sudo access to Python and runsc and an unsupported
job kind were rejected. The temporary account and sudo rule were removed after
the test, and both existing CI runner services remained active. This validates
the temporary rule and tested helper on this host, not a persistent production
installation, independent image provenance, privileged preflight or live flow.

A further temporary-account test exercised the signed Unix-socket service,
helper transport, narrow sudo rule and offline gVisor compiler together. It
returned the expected synthetic heading and build digest
`0a72d6c24a5c6a52a1ab327b64a56b5be27f1b7f8255f7a372a6042f392293f8`.
The preflight was deliberately synthetic: this is a plumbing test, not an
installation receipt or independent production provenance. The temporary helper,
account and sudo rule were removed; both existing CI runner services remained
active. No public ingress, orders or storefront publication were involved.

An initial temporary privileged preflight test using the same-host observed
pin did not return within its 300-second deadline while inventory hashing was
active alongside CI. The temporary user, sudo rule, pin and executable files
were removed. The startup timeout was raised for a further test; that first
attempt did not establish a successful privileged preflight or provenance.

The longer temporary-account retry completed successfully in approximately
539 seconds, returning toolchain digest
`6db6c3ab85ea3d4a196eff3c63204a8c17f0821cd910ca892503245f7bd4af80`.
It used the same-host observed pin, not an independently approved release pin.
The temporary account, sudo rule, preflight executables and protected pin were
removed, and both existing CI runner services remained active. The long startup
time needs operational consideration; this test does not authorize activation.

On a subsequent read-only source comparison, `prerender-build-worker.mjs` and
`bounded-input.mjs` in both installed rootfs trees matched the corresponding
current-worktree files by SHA-256. This checks only those two files: the base
images, generated bundles, dependencies, other workers, ownership and complete
trees still need independent release provenance. It is not a trusted pin.

On 12 November, the six generated fixed-worker outputs were independently
rebuilt on the Mac from the current main-synced worktree using esbuild: Node
ESM bundles for `performance-worker.ts` (external `playwright-core`),
`interaction-worker.ts` and `browser-checks.ts` (external `playwright-core`,
`react`, `react-dom/server`), and `bundle-source.ts` (external `esbuild`, for
both bundle filenames); plus the minified browser ESM `checkpoint-b-host.tsx`
with automatic JSX and `NODE_ENV=production`. SHA-256 matched each corresponding
file in both Contabo rootfs trees. This comparison includes uncommitted source
and independently rebuilds only these outputs; the base images, installed
dependencies, complete filesystem inventory and release approval remain
unverified. It does not establish a deployable installation pin.

The same source comparison also matched the copied non-test experience SDK and
shared experience source files in both rootfs trees, as well as the unbundled
compile and prerender workers. Package dependency contents, non-source files,
file metadata and base OS image provenance were not covered by that comparison.

The original Contabo setup command was recovered: it copied the AMD64 Node
image `sha256:9af606de2e947cfb3f276633b7c5130c4cd22365aa10f5a647b7675d5cfce0c0`
and Playwright image `sha256:bc6ab0d6d44ff4826e4cb8c1e6d801e185bfc42bb0753f8e2a30efc70db054c7`
from a dedicated containerd namespace, then added the worker archive and a
browser Node symlink. The Node manifest was fetched independently from Docker
Hub and its bytes and registry digest matched that SHA-256. Both image manifests
are present and unpacked on Contabo, and the retained worker archive matches its
recorded SHA-256. These observations do not establish complete image contents
or a trusted pin. An initial read-only filesystem comparison lost its SSH result
after its remote process exited; its result is inconclusive. A second comparison
records its status remotely. It completed with `rsync_exit=0` and
`cleanup_exit=0`; the only reported difference outside the excluded
`/opt/experience/` tree was the `opt/` directory timestamp. The comparison
used checksum, ownership, permissions, hard links, ACLs, xattrs and a dry-run
delete check against the locally retained digest-addressed image; it did not
independently verify each stored layer against the registry or cover the
excluded worker/dependency tree. Both CI services remained active. This is
partial compiler-base evidence, not a complete trusted installation pin.

The equivalent read-only browser-base comparison completed on Contabo with
`rsync_exit=0` and `cleanup_exit=0`, recorded in
`/tmp/baci-browser-base-verify-20261112.log`. It excluded the added worker
tree and the intentionally installed `/usr/local/bin/node` symlink. The only
reported differences were timestamps on `/opt/` and `/usr/local/bin/`. This
compares against the retained digest-addressed image, not independently
re-downloaded and verified registry layers.

The ten dependency archives used for the worker tree were independently
rehashed and matched both the current pnpm lockfile and npm registry integrity
metadata. Freshly extracted archive contents were then compared by checksum in
both installed `node_modules` trees with a dry-run deletion check; no file
differences were reported, excluding the two expected `@baci` workspace links.
The links and both linked package manifests matched the current workspace.
This did not compare ownership, permissions, xattrs or the rest of either
filesystem, and does not by itself qualify a production installation.

The retained x86-64 gVisor archive SHA-512 matches the vendor checksum fetched
independently on the Mac. The installed `runsc` bytes also matched a fresh
extraction of that archive, and a recursive checksum comparison found no file
differences in `gvisor-bin`. That comparison did not establish the metadata or
immutability of those files and is not an installation pin.

A separate local-VM extraction of that vendor-verified archive and inventory of
its `gvisor-bin` metadata completed. The first attempt failed because the VM
lacks bzip2; the successful attempt decompressed on the Mac. Its inventory
and `runsc` file SHA-256 exactly match the observations below.
The installed Contabo `gvisor-bin` inventory is
`9aed8725b3d5f970c065fb72ef4143187d0c1bf5683b561fb0a193e263f34c1f`
(7 entries, 122,268,901 bytes); installed `runsc` SHA-256 is
`5b4016fa43a9d35835253925cb6d05d3e42fdb9eb8bcd426c8b25444090e93e6`.
These values match the separate extraction, including owner and mode in the
`gvisor-bin` inventory; they do not on their own approve a production pin.

Both installed `/opt/experience` trees were also compared against a fresh
root-owned extraction of the recorded worker archive using checksum, ownership,
permissions, hard links, ACLs, xattrs and a dry-run deletion check. Neither tree
reported differences. A separate low-priority process (Contabo PID 3141498)
checked each locally retained OCI manifest, config and layer blob against its
content digest; `/tmp/baci-verify-oci-blobs-20261112.log` ends in
`all_blobs_verified`. This establishes content-address integrity for the
retained blobs, but not independent provenance for the whole installed tree.

An independent pull of the pinned AMD64 Node image succeeded in the active
`colima-pvb-e2e` Docker context, which was not the intended default VM. The
task-owned Playwright pull there was stopped; no unrelated processes were
changed. The Node image was subsequently imported into a dedicated namespace
in the default VM. The Playwright pull was restarted explicitly against the
default `colima` context as local PID 42139, but that detached client exited
without output and the image was absent. A foreground pull in the same explicit
context (exec session 21017) failed extracting a layer with `no space left on
device`. The default VM's `/var/lib/containerd` is a separate 98G filesystem
at 100%; the earlier root filesystem check did not cover it. The task-owned
independent Node image reference was removed from its dedicated containerd
namespace after the reconstructed tree was retained, but the volume still
reported zero unprivileged available space. Docker reports 1,316 local volumes
and 53G of unreferenced volume data; their ownership and safety for removal are
not established. No volume prune, service restart or unrelated cleanup occurred.

To continue without changing those shared volumes, the obsolete task-owned
first compiler reconstruction was removed after retaining its replacement. An
isolated temporary containerd process in the default VM (PID 850839) now uses
its own root, state and socket under `/var/tmp/baci-independent-pin-20261112`,
on the separate root filesystem. A digest-pinned AMD64 Playwright pull is
running there as PID 851513 with output in `browser-pull.log` under that
directory. This does not restart or reconfigure the shared Docker service.
Check both PIDs, the log and disk capacity before restarting or cleanup.

An independent AMD64 compiler filesystem was reconstructed in the local Linux
VM at `/var/tmp/baci-independent-pin-20261112/node24/rootfs`, using the
separately pulled pinned image and recorded worker archive. Its deterministic
inventory completed locally with SHA-256
`a9ddf6d4e656862298abadd016c12b389acfd84a13092b8b8cbbd91fcd585fdb`
(34,870 entries, 1,179,869,732 file bytes). The same inventory of the installed
Contabo tree finished and wrote `/tmp/baci-contabo-node-inventory-20261112.log`.
The first independent inventory did
not match Contabo because `docker export` introduced six container-specific
paths and changed two resolver files. A replacement baseline was assembled
from a read-only image-layer view in the default VM, with the worker archive
overlaid. Its completed inventory in `/tmp/baci-independent-node-v2-inventory.log`
matches the Contabo inventory at digest
`e617b383f90471f3bdb96c55bbb11d3f6e4874821eee2f1805fb0d50ec07ac75`
(34,864 entries, 1,179,869,850 file bytes). The browser tree, independently
reviewed release metadata and full protected pin remain to be qualified.

Contabo's browser-tree inventory completed with digest
`def7340a862ff7d7afc573683a4bbaa87e0ceffbe1ddb733f7892fb82a071d7e`
(37,172 entries, 2,510,771,836 file bytes), recorded in
`/tmp/baci-contabo-browser-inventory-20261112.log`. It must be
compared with an independent image-layer reconstruction after the local image
pull finishes; the observed result is not an approved pin by itself.

The previously observed toolchain profile is stale for the current candidate:
its OCI-policy source hash matches commit `5dd429f6a9`, while the current
`local-oci-executor.ts` exports helper constants and extends capture's timeout
from 30 to 60 seconds. The current candidate profile was recalculated locally
as `/tmp/baci-builder-current-toolchain-unqualified.json`, digest
`8967543de1db07cd42abe5489725ecd76ab4411371d22bf00341776586947e06`.
Current platform source and generated worker hashes match the prior profile;
the current OCI policy and local executor unit tests passed (13 tests). The
new profile has not been independently approved or exercised as a protected
production installation, and the prior host receipt must not be presented as
qualification of the new digest.

The helper and transport currently list three additional browser job kinds
(`prerender-checks`, `prerender-private-checks`, `durable-public-checks`), but
their corresponding `prerender-browser-worker.mjs`,
`private-preview-browser-worker.mjs`, and `public-browser-worker.mjs` are
absent from both installed trees. The existing durable public browser worker is
also an Orbit-specific offline fixture, not a generic live observer. A complete
release must either provide and qualify appropriately scoped fixed workers or
explicitly reject unsupported job kinds at the production boundary. Do not
treat successful inventory of the present files as job coverage.

The local candidate now rejects those three uninstalled fixture-only kinds in
both the service helper adapter and the privileged helper itself. Regression
tests first reproduced their acceptance, then passed after both guards were
changed (15 focused tests). This change is not installed on Contabo; a new
reviewed candidate and qualification are required, and the generic public
browser observer is still missing.

The pinned Playwright image was independently pulled into a separate local VM
containerd namespace. A read-only overlay of its layers, with the independently
verified worker archive and required Node symlink applied, produced inventory
digest `def7340a862ff7d7afc573683a4bbaa87e0ceffbe1ddb733f7892fb82a071d7e`
(37,172 entries, 2,510,771,836 file bytes). This matches the previously captured
Contabo browser tree inventory. It verifies filesystem consistency, not the new
toolchain policy, execution isolation, production service, public verifier, or
live merchant journey.

A temporary preflight using the current helper and locally assembled candidate
pin first failed schema validation because the gVisor-directory digest was
copied incompletely. The temporary files and sudo rule were removed by the
qualification script. A separate retry uses the complete independently checked
digest, current toolchain digest and a fresh isolated candidate directory. It
is running at low CPU and I/O priority; its result and cleanup must be checked
before claiming a current preflight receipt. This is a temporary qualification,
not production activation or an approved release pin. That retry completed
successfully and returned toolchain digest
`8967543de1db07cd42abe5489725ecd76ab4411371d22bf00341776586947e06`.
The temporary user, sudo rule and privileged files were confirmed removed;
both CI services remained active. The standalone preflight bundle differed
from the operator candidate only in its generated first-line import banner,
but has a different hash. An additional low-priority preflight is running with
the exact assembled operator preflight bundle (SHA-256
`766df4f80a7c19b57a270499867c174dfe1bd31372d05101d20735023f5595a5`);
it also returned the same toolchain digest successfully. The temporary user,
sudo rule and privileged files were removed and both CI services remained
active. Neither result proves the public verifier, deployed service, or live
merchant flow.

A subsequent temporary-account test started the current
`startQualifiedRunnerService`, including the exact operator preflight bundle,
the independently measured pin and current helper. A signed request over its
private Unix socket completed an offline, network-disabled synthetic compile
with the expected heading (build digest
`0a72d6c24a5c6a52a1ab327b64a56b5be27f1b7f8255f7a372a6042f392293f8`).
The temporary service, user, sudo rule and privileged files were removed, and
both CI services remained active. The service test was independently bundled
from current source and is not a configured startup of the exact operator
`runner.mjs`; no public ingress, order, payment or publication was involved.

A further temporary test has started the exact assembled `runner.mjs`
(`d2ed02573e46f70730bc2e9e9272705461a69f4a4bae73e7a86c2b2aa400e2db`)
with its protected preflight and a loopback-only listener. Its synthetic
signed compile passed with the same expected heading and build digest
`0a72d6c24a5c6a52a1ab327b64a56b5be27f1b7f8255f7a372a6042f392293f8`.
The test observed a zero exit status, removed its temporary account, sudo rule,
private runner directory and privileged files, and confirmed both CI services
remained active. No public ingress was configured. This is a temporary
synthetic host qualification, not a persistent deployment, public verifier,
live OAuth connection or end-to-end merchant checkout.

On 13 November the exact `ReYXog` candidate observer worker (SHA-256
`84b1a853e570aa8d1e7005f767347e537e91842ca9adc00fdc3dc8178312e808`)
was transferred to a root-owned temporary directory, hash-checked and mounted
read-only into the existing Contabo browser rootfs for a network-disabled
gVisor synthetic route, dynamic-script and checkout-review test. The first
attempt failed after approximately 75 seconds with a generic observer error;
the retry passed in approximately 72 seconds including test setup and cleanup.
Cart responses were simulated and the test used its own helper adapter, not
the installed production helper or live backend. Both temporary sandboxes and
files were removed, and both existing GitHub runner services remained active.
The timeout and slow runtime need investigation before production qualification.

A subsequent instrumented synthetic run passed: the job's measured worker
wall time was 50.9 seconds, and the first host-channel request arrived 22.2
seconds after invocation; the three synthetic commerce requests arrived at
41.7, 44.3 and 46.6 seconds. The equivalent local gVisor job took 6.2 seconds,
with its first request at 3.4 seconds. The Contabo test uses an SSH duplex
channel from the Mac, while the proposed co-located production observer uses
local pipes. These are not comparable production benchmarks and do not isolate
the cause of the delay. The earlier timeout remains unresolved.

The same candidate worker was then run with its synthetic relay co-located on
Contabo, removing the Mac-to-Contabo SSH channel from individual browser
requests. It passed in 29.2 seconds of worker time; the first request arrived
at 14.4 seconds and the synthetic cart commands at 26.1, 26.2 and 26.7 seconds.
This single run indicates the remote request path contributed to the earlier
measurement, but also shows substantial startup/route observation time on
Contabo. It used simulated commerce and a test helper, not the privileged
production helper or actual Supabase. Temporary artifacts and sandbox were
removed, and both CI runner services remained active.

The exact candidate helper (SHA-256
`2a4be71a14696a62e3ee47d2202ca942cacf86e9fd76a69a7c3d488b640235f6`)
then prepared, ran and deleted the same exact observer worker using its fixed
network-disabled policy on Contabo. The co-located synthetic job passed in
39.2 seconds. The worker was temporarily added with exclusive creation to the
browser rootfs and removed only after its hash was rechecked; the temporary
helper, controller and job were removed, and both CI runner services remained
active. The helper was invoked directly as root for this trial: this does not
qualify a dedicated service account, sudo policy, protected installation pin,
real Supabase commerce, or production startup.

A further co-located synthetic run used a temporary unprivileged system user
and a `visudo`-validated passwordless rule limited to the exact fixed helper
path. The same candidate helper and worker completed the observer flow in
41.9 seconds. The user could not invoke `runsc` directly or ask the helper to
perform an unsupported operation. The account, sudo rule, temporary helper,
worker, controller and sandbox were removed; both CI services remained active.
This tests a temporary privilege boundary, not an installed service, protected
installation pin, live OAuth or actual Supabase-backed commerce.

The local runtime builder and operator assembly previously used different
esbuild options for the public observer, so they could describe different
worker bytes. Both now use the same shared bundler; an assembly regression
test compares their SHA-256 outputs. The earlier apparent differences in the
other worker bundles were traced to esbuild's working-directory-dependent
module labels: rebuilding from the original repository-root working directory
matched all five previous bundle hashes. The host shell, platform source and
OCI policy hashes also match the earlier profile. An AMD64 candidate profile
including the observer has been calculated locally at
`/tmp/baci-builder-amd64-observer-profile-unqualified.json` with digest
`2fba2335351e62e55017ba6ba40e6317968816486cca7dad5d67469717806710`.
This is not a protected or approved installation pin; the new browser tree
still needs independent inventory comparison and review.

An updated independent browser-tree inventory with the observer staged has
completed locally: digest
`4f0740a188ae93c9009c71a57a67f22712baf4f1d5f7aeefe3dbbf098ea6fdc5`
(37,173 entries, 2,511,735,693 bytes). A matching Contabo inventory is in
progress at low priority with the worker temporarily staged under the browser
rootfs and task files in `/var/tmp/baci-pin-check-OUAv4M9N`. The first SSH
session lost its result after the remote inventory process exited. A new
detached, task-owned run (wrapper PID 3171892) writes `inventory.stdout`,
`inventory.stderr` and `inventory.exit` in that directory so its outcome
survives a connection failure. Do not restart or remove those files while the
process is running; compare the result and safely remove the temporary Contabo
worker and task files afterward. The durable run completed but differed by one
zero-byte entry. The extra file was an empty, root-owned `public-observer.mjs`
mount placeholder created by the first task-owned bind-mount test at 16:30;
its metadata and absence of active jobs were verified before removing it. The
test now binds over an existing file so it does not create that placeholder.
A second durable inventory completed with exit 0 and exactly matched the
independent digest, entry count and bytes. A local unqualified candidate pin
is at `/tmp/baci-builder-observer-pin-unqualified.json`.

A temporary protected-preflight trial completed with exit 0 and returned
toolchain digest `2fba2335351e62e55017ba6ba40e6317968816486cca7dad5d67469717806710`.
It used the exact candidate helper and preflight bundle, a root-owned candidate
pin and a temporary restricted user with a validated helper-only sudo rule.
The protected files, account and staged browser worker were confirmed removed;
both CI services stayed active. Logs remain in the root-owned task directory
`/var/tmp/baci-pin-check-OUAv4M9N`. This is a temporary installation
qualification, not an independently approved release, persistent deployment,
live OAuth test or merchant journey. No service was enabled by the trial.
